import * as OBSWebSocket from 'obs-websocket-js';
import { Scene } from 'obs-websocket-js';
import * as OSC from 'osc-js';
import * as fs from 'fs';
import * as os from 'os';

import { autoCropZoomGallery, CropValues } from './cropsy'

// OBS client
const obsHost = 'localhost';
const obsOutPort = 4444
const obsPassword = undefined;

// OSC server (port to listen to ZoomOSC and clients)
const zoomInPort = 1234

const zoomOutHost = 'localhost';
const zoomOutPort = 8000

const configPath = os.homedir() + '/Documents/performance_config.txt';

const udpOptions = {
    open: {
        host: 'localhost',
        port: zoomInPort,
    },
    send: {
        host: zoomOutHost,
        port: zoomOutPort
    }
}
const obs = new OBSWebSocket();
const osc = new OSC({ plugin: new OSC.DatagramPlugin(udpOptions) });

/**
 * This is what we need to know about a given obs scene
 */
type SceneInfo = {
    scene: Scene;
    sourceProps: any[];
    crops: CropValues[];
}

/**
 * This is the stuff in state
 */
type StateType = {
    count: number;
    order: number[];
    orderedNames: string[];
    participants: string[];
    assignedOrderNames: string[];
    assignedOrderInd: number[];
    scenes: SceneInfo[];
    sceneNamePrefix: string;
}

/**
 * Global state used throughout
 */
const state: StateType = {
    count: 0,
    order: [],
    orderedNames: [],
    participants: [],
    assignedOrderNames: [],
    assignedOrderInd: [],
    scenes: [],
    sceneNamePrefix: "z"
}

/**
 * do it
 */
run();
console.log("done with run()");

/**
 * Start up the app
 */
function run() {
    setupOBS();
    setupOSC();

    osc.open()
    obs.connect({ address: `${ obsHost }:${ obsOutPort }`, password: `${ obsPassword }` });

    // tell zoomOSC to load names from the performance_config.txt file
    // we need all names that need to be tracked so we can do our ordering
    (async() => {
        await sendToZoom('/zoom/load', 1.0);
    })();

}

/**
 * Update our user data from ZoomOSC
 */
async function updateUsers() {
    // not crazy about the delays. since udp is async, we don't know when they are done, so we need
    // to wait. Alternatively, it could poll the file to see if it's timestamp changes, but that
    // Really what we want is a call to zoomosc that would return the list to the /zoomosc port here
    // await sendToZoom('/zoom/include', 1.0);
    // await sleep(100);
    // await sendToZoom('/zoom/save', 1.0);
    // await sleep(1000);
    await readConfig();
}

/**
 * Read the configfile created by ZoomOSC to get the list of users in order
 */
async function readConfig() {
    try {
        const data = await fs.promises.readFile(configPath);
        state.participants = data.toString().split("\n");
        console.log("read config", state.participants);
    } catch (e) {
        console.error("Failed to read file", configPath);
        throw e;
    }
}

/**
 * Send a command to ZoomOSC
 *
 * @param message main message to send '/cmd/subcommand/...'
 * @param args args to the command... any type of count
 */
async function sendToZoom(message: string, ...args: any[]): Promise<any> {
    console.log("Sending to Zoom: %s, %s", message, args);
    return osc.send(new OSC.Message(message, ...args));
}

/**
 * Given a scene, crop all of the sources (items) to match the number of entries
 * using the Zoom sizing/spacing algorithm
 *
 * @param sceneInfo the stuff we know about the scene
 */
async function cropSourcesInScene(sceneInfo: SceneInfo) {
    const scene = sceneInfo.scene;

    // only care about display_capture and window_capture for this
    const sources = scene.sources.filter(source => (source.type === 'display_capture') || source.type === 'window_capture')
    if (sources.length === 0) return;

    const sourceWidth = sources[0].source_cx;
    const sourceHeight = sources[0].source_cy;
    const crops = autoCropZoomGallery(sourceWidth, sourceHeight, sources.length);
    let i = 0;
    for (const source of sources) {
        // needs all the elements for type-safety, but only changes ones that aren't undefined
        await obs.send('SetSceneItemProperties', {
            "scene-name": scene.name,
            item: { id: source.id },
            position: undefined,
            rotation: undefined,
            scale: undefined,
            crop: crops[i],
            visible: undefined,
            locked: undefined,
            bounds: undefined
        });
        sceneInfo.crops = crops;
        i++;
    }
}

/**
 * Change the order of the boxes according to the state assigned order of the participants.
 * The natural order is the layout given by zoon.
 * The "assigned" order is one set by the client via osc command /orderByName
 *
 * @param sceneInfo the scene getting its boxes reordered
 */
async function reorderScene(sceneInfo: SceneInfo) {
    if (state.assignedOrderNames.length < state.order.length) return;
    const scene = sceneInfo.scene;
    for (let sourceInd = 0; sourceInd < sceneInfo.crops.length; sourceInd++) {
        const source = scene.sources[sourceInd];
        const crops = sceneInfo.crops;
        // only include subset of assigned names that are visible
        const assignedNames = state.assignedOrderNames.filter(name => state.orderedNames.includes(name));
        const nameInAssignedPosition = assignedNames[sourceInd];
        const indexInNaturalOrder = state.orderedNames.findIndex(name => name === nameInAssignedPosition);
        // crop obsInd to be the one from assignedIndex
        await obs.send('SetSceneItemProperties', {
            "scene-name": scene.name,
            item: { id: source.id },
            position: undefined,
            rotation: undefined,
            scale: undefined,
            crop: crops[indexInNaturalOrder],
            visible: undefined,
            locked: undefined,
            bounds: undefined
        });
    }
}

/**
 * Setup connection with OBS.
 * Get the list of scenes so we can deal with them later.
 * Set up natural crop sizes for all the sources of all the scenes.
 */
function setupOBS() {
    obs.on('ConnectionOpened', async () => {
        console.log('Connected to OBS');

        // store all the existing scenes into the global state
        const result = await obs.send('GetSceneList');
        state.scenes = result.scenes.map((scene): SceneInfo => ({
            scene: scene,
            sourceProps: [],
            crops: []
        }));

        // crop every source of every scene to match the zoom boxes
        for (const scene of state.scenes) {
            await cropSourcesInScene(scene);
        }

        // get the current set of users
        await updateUsers();
    });
}

function setupOSC() {

    // helpful if we want to listen to all messages, including ones for which we don't have explicit listeners
    // osc.on('*', message => {
    //     console.log("OSC * Message", message)
    // });

    // /zoomosc listeners
    // osc.on('/zoomosc/chat', async message => console.log("/zoomosc/chat", message.args));

    // osc.on('/zoomosc/activeSpeaker', async message => console.log("/zoomosc/activeSpeaker", message.args));
    // osc.on('/zoomosc/audio/status', async message => console.log("/zoomosc/audio/status", message.args));

    // osc.on('/zoomosc/sound/on', async message => console.log("/zoomosc/sound/on", message.args));
    // osc.on('/zoomosc/sound/off', async message => console.log("/zoomosc/sound/off", message.args));

    osc.on('/zoomosc/video/off', async message => console.log("/zoomosc/video/off", message.args));
    osc.on('/zoomosc/video/on', async message => console.log("/zoomosc/video/on", message.args));

    osc.on('/zoomosc/gallery/order', async message => await zoomoscOrder(message.args));
    osc.on('/zoomosc/gallery/count', async message => await zoomoscCount(message.args));

    // /zaf listeners (our own app stuff)
    osc.on('/zaf/scene', async message => await doSetScene(message.args[0]));
    osc.on('/zaf/transition', async message => await doSetTransition(message.args[0], message.args[1]));
    osc.on('/zaf/orderByName', async message => await doSetNameOrder(message.args));
    osc.on('/zaf/sceneNamePrefix', async message => await doSetSceneNamePrefix(message.args[0]));
    osc.on('/zaf/state', async () => await doPrintState());
}

/**
 * Helper to wait for things to happen from within async functions
 *
 * @param ms milliseconds to sleep
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fade to the next scene. Fade out to blank and then into the new scene
 * This helps hide sudden changes on the zoom size
 *
 * @param name new scene name
 * @param blankScene name of blank scene for transition
 */
async function fadeToScene(name: string, blankScene: string) {
    const transitionTime = 1000;
    await doSetTransition("Fade", 500);
    await sleep(50);
    await doSetScene(blankScene);
    await doSetTransition("Fade", transitionTime);
    await sleep(transitionTime);
    await doSetScene(name);
}

/**
 * Set scene to the named one
 *
 * @param name name of the new scene
 */
async function doSetScene(name: string) {
    try {
        await obs.send('SetCurrentScene', { 'scene-name': name })
    } catch (e) {
        console.error("Failed to set scene to %s", name, e);
    }
}

/**
 * Set the next transition to be the one named and set duration if given
 *
 * @param name name of the transition
 * @param ms (optional) milliseconds duration of the transition
 */
async function doSetTransition(name: string, ms: number) {
    try {
        await obs.send('SetCurrentTransition', { 'transition-name': name })
        ms !== undefined && await obs.send('SetTransitionDuration', { 'duration': ms })
    } catch (e) {
        console.error("Failed to set traisition to %s", name, e);
    }
}

/**
 * Set the box order to the list of names given.
 * This will set the order of the _capture frames in OBS to be in the order of the names of participants in Zoom
 * rather than the order given by zoom directly.
 *
 * @param names ordered list of names of zoom participants. This should be a superset of all zoom participants
 */
async function doSetNameOrder(names: string[]) {
    console.log("doSetNameOrder:", names);
    state.assignedOrderNames = names;

    // force the current scene to be reordered if needed
    const currentScene = await obs.send('GetCurrentScene');
    const sceneInfo = state.scenes.find(info => info.scene.name === currentScene.name);
    await reorderScene(sceneInfo);
}

/**
 *  For debugging, what does everything look like
 */
async function doPrintState() {
    console.log("state:", state);
}

/**
 * Set Scene prefix for number in gallery. Default is "z"
 *
 * @param prefix string to prefix scene names that will represent different gallery counts
 */
async function doSetSceneNamePrefix(prefix: string) {
    console.log(`Name your scenes "${prefix}1", "${prefix}2", ... "${prefix}n"`);
    state.sceneNamePrefix = prefix;
}

/**
 * Handle an inbound /zoomosc/order change. Update the default zoom order of the boxes
 *
 * @param order indexes into participants in the order of their zoom boxes
 */
async function zoomoscOrder(order: number[]) {
    console.log("zoomoscOrder", order);
    state.order = order;
    await checkCountChange(order.length);
}

/**
 * Handle inbound /zoomosc/count message
 *
 * @param count new cound of visible boxes in zoom
 */
async function zoomoscCount(count) {
    console.log("zoomoscCount", count);
}

/**
 * User order or count changed. Update the OBS scene and reorder if needed.
 * @param newCount
 */
async function checkCountChange(newCount) {
    console.log("checkCountChange", newCount);
    const oldCount = state.count;

    // get the ordered list of participants (delays added to request, fill file, then read file contents)
    await updateUsers();

    // scenes are z<count>, eg. a scene for 5 participtnas is "z5"
    // scene name prefix can be changed, but default is "z"
    const sceneName = `${state.sceneNamePrefix}${ newCount }`;

    const sceneInfo = state.scenes.find(info => info.scene.name === sceneName);
    state.count = newCount;
    if (state.order.length === 0) {
        return;
    }
    state.orderedNames = state.order.map(ind => state.participants[ind]);
    await reorderScene(sceneInfo);

    (oldCount !== newCount) && await fadeToScene(`z${ newCount }`, "blank-black");

    state.count = newCount;
}
