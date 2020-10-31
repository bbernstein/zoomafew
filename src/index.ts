import * as OBSWebSocket from 'obs-websocket-js';
import { Scene } from 'obs-websocket-js';
import * as OSC from 'osc-js';
import * as fs from 'fs';
import * as os from 'os';

import { autoCropZoomGallery } from './cropsy'

// OBS client
const obsHost = 'localhost';
const obsOutPort = 4444
const obsPassword = undefined;

// OSC server (port to listen to ZoomOSC and clients)
const zoomInPort = 1234

const zoomOutHost = 'localhost';
const zoomOutPort = 8000

const configPath = os.homedir() + '/Documents/performance_config.txt';

// let scenes: Scene[] = [];

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

const state: any = {
    count: 0,
    order: [],
    participants: []
}

// testAutoCrop();
run();

function run() {
    setupObsListeners();
    setupOscListeners();

    osc.open()
    obs.connect({ address: `${ obsHost }:${ obsOutPort }`, password: `${ obsPassword }` });
}

async function updateUsers() {
    await sendToZoom('/zoom/update', 1.0);
    await sleep(100);
    await sendToZoom('/zoom/save', 1.0);
    await sleep(100);
    await readConfig();
}

async function readConfig() {
    try {
        const data = await fs.promises.readFile(configPath);
        state.participants = data.toString().split("\n");
    } catch (e) {
        console.error("Failed to read file", configPath);
        throw e;
    }
}

async function sendToZoom(message: string, ...args: any[]): Promise<any> {
    console.log("Sending to Zoom: %s, %s", message, args);
    return osc.send(new OSC.Message(message, ...args));
}


async function cropSourcesInScene(scene: Scene) {

    // only care about display_capture
    // others probably care about window_capture and others

    console.log("sources:", scene.sources);

    const sources = scene.sources.filter(source => (source.type === 'display_capture') || source.type === 'window_capture')
    if (sources.length === 0) return;

    console.log("Cropping %d sources in scene %s", sources.length, scene.name)

    const sourceWidth = sources[0].source_cx;
    const sourceHeight = sources[0].source_cy;
    const crops = autoCropZoomGallery(sourceWidth, sourceHeight, sources.length);
    let i = 0;
    for (const source of sources) {
        await obs.send('SetSceneItemProperties', {
            "scene-name": scene.name,
            item: { id: source.id },
            position: undefined,
            rotation: undefined,
            scale: undefined,
            crop: { left: crops[i].left, right: crops[i].right, top: crops[i].top, bottom: crops[i].bottom },
            visible: undefined,
            locked: undefined,
            bounds: undefined
        })
        i++;
    }
}

function setupObsListeners() {
    obs.on('ConnectionOpened', async () => {
        console.log('Connection Opened');

        const result = await obs.send('GetSceneList');
        const scenes = result.scenes;
        for (const scene of scenes) {
            await cropSourcesInScene(scene);
        }

        await sendToZoom('/zoom/galtrack', 1.0);
        await sleep(100);
        await updateUsers();
        console.log("config", state);
    });

    obs.on('SwitchScenes', data => {
        console.log('SwitchScenes', data['scene-name']);
    });
}

function setupOscListeners() {
    // osc.on('*', message => {
    //     console.log("OSC * Message", message)
    // });
    osc.on('/zoomosc/chat', async message => console.log("/zoomosc/chat", message.args));

    osc.on('/zoomosc/activeSpeaker', async message => console.log("/zoomosc/activeSpeaker", message.args));
    osc.on('/zoomosc/audio/status', async message => console.log("/zoomosc/audio/status", message.args));

    osc.on('/zoomosc/sound/on', async message => console.log("/zoomosc/sound/on", message.args));
    osc.on('/zoomosc/sound/off', async message => console.log("/zoomosc/sound/off", message.args));

    osc.on('/zoomosc/video/off', async message => console.log("/zoomosc/video/off", message.args));
    osc.on('/zoomosc/video/on', async message => console.log("/zoomosc/video/on", message.args));

    osc.on('/zoomosc/gallery/order', async message => await zoomoscOrder(message.args));
    osc.on('/zoomosc/gallery/count', async message => await zoomoscCount(message.args));

    osc.on('/zaf/scene', async message => await actionScene(message.args[0]));
    osc.on('/zaf/transition', async message => await actionTransition(message.args[0], message.args[1]));
    osc.on('/zaf/getSourcesList', async message => await actionGetSourcesList())
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fadeToScene(name: string, blankScene: string) {
    const transitionTime = 1000;
    await actionTransition("Fade", 500);
    await sleep(50);
    await actionScene(blankScene);
    await actionTransition("Fade", transitionTime);
    await sleep(transitionTime);
    await actionScene(name);
}

async function actionScene(name: string) {
    console.log("actionScene", name);
    try {
        await obs.send('SetCurrentScene', { 'scene-name': name })
    } catch (e) {
        console.error("Failed to SetCurrentScene", name);
    }
}

async function actionTransition(name: string, millis: number) {
    console.log("actionTransition", name, millis);
    await obs.send('SetCurrentTransition', { 'transition-name': name })
    millis !== undefined && await obs.send('SetTransitionDuration', { 'duration': millis })
}

async function actionGetSourcesList() {
    console.log("actionGetSourcesList");
    const result = await obs.send('GetSourcesList');
    const sources = result.sources;
    for (const source of sources) {
        const sourceSettings = await obs.send('GetSourceSettings', { 'sourceName': source['name'] })
        console.log("source setting", sourceSettings)
    }
    console.log("GetSourcesList", result)
}

async function zoomoscOrder(order: number[]) {
    console.log("zoomosc-order", order);
    state.order = order;
    await checkCountChange(order.length);
    await updateUsers();
    console.log("Order changed. new state", state);
}

async function zoomoscCount(count) {
    console.log("zoomosc-count", count);
    // await checkCountChange(count);
}

type CaptureSource = {
    name: string;
    type: string;
}

type SceneInfo = {
    captureSources: CaptureSource[];
}

const scenes: SceneInfo[] = [];

async function checkCountChange(newCount) {
    const oldCount = state.count;
    (oldCount !== newCount) && await fadeToScene(`z${ newCount }`, "blank-black");
    // const source = await sourceInfo();

    state.count = newCount;
}

async function sourceInfo(): Promise<any> {
    // get screen info from the source
    const scene = await obs.send('GetCurrentScene');
    let sourceWidth = 0;
    let sourceHeight = 0;

    console.log("Current Scene", scene.name);
    for (const source of scene.sources) {
        // console.log("source", source.name);
        const itemProps = await obs.send('GetSceneItemProperties', {
            'scene-name': scene.name,
            'item': { 'name': source.name }
        })
        if (itemProps.sourceHeight !== undefined && itemProps.sourceWidth !== undefined) {
            sourceHeight = itemProps.sourceHeight;
            sourceWidth = itemProps.sourceWidth;
            break;
        }
        // console.log("item", itemProps)
    }
    return { scene: scene.name, sourceWidth: sourceWidth, sourceHeight: sourceHeight };
}

function testAutoCrop() {
    const sourceWidth = 3840;
    const sourceHeight = 2400;
    for (let i = 1; i <= 25; i++) {
        const result = autoCropZoomGallery(sourceWidth, sourceHeight, i);

        console.log("%d items", i, result);
    }
}

