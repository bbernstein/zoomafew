# zoomafew

This tool helps connect [ZoomOSC](https://www.liminalet.com/zoomosc) with [OBS Studio](https://obsproject.com/), allowing you to order your boxes by the names of the participants rather than the random order that Zoom sets them.

I wrote this in TypeScript
You need nodejs installed to build and use it.

## Requirements

- [OBS Studio](https://obsproject.com/)
- [obs-websocket plugin](https://obsproject.com/forum/resources/obs-websocket-remote-control-obs-studio-from-websockets.466/)
- [ZoomOSC](https://www.liminalet.com/zoomosc)
- Time to experiment with settings

## Warning

This tool may change the cropping of everything in the current Scene Collection. Create a new one or duplicate an old one before running it.

## To Install

```
npm install
```

## To Run

First make sure you're already running OBS and ZoomOSC, with ZoomOSC in Gallery mode, then:

```
npm start
```

## To Setup

Set up OBS:
Create a bunch of scenes names:

`z1, z2, z3, ...`

For each of the layouts you'd like for your participants depending on how many will have their cameras on.
For each of those scenes, create a source pointing to the screen or window that will contain the zoom.
You probably want to make each capture small enough to fit on the page, but you don't need to figure out the croppings.
That magic will happen here.

You'll also need to set up the list of all the users who will be joining in `Documents/performance_config.txt`. That 
needs to be the exhaustive list of users who will be joining the meeting and will be the main index for your layouts.

Now you can tell zoomafew the order in which you'd like the users displayed with the command:

```
/zaf/orderByName "actor 1", "Another Actor", "The Other participant" ...
```

And the sources will be cropped to show those users in that order rather than the order made by zoom.

## Commands

Change to scene
```
/zaf/scene <scenename>
```

Set Transition and Duration for next scene change:
```
/zaf/transition <name> <duration-ms>
```

Set the order of the sources by participant name:
```
/zaf/orderByaName <name1> <name2> <name3> ...
```

Prefix to use for scene names (defualt "z").
```
/zaf/sceneNamePrefix <prefix>
```

State of the app internals (helpful for debugging):
```
/zaf/state
```
