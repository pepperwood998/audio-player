window.AudioContext = window.AudioContext || window.webkitAudioContext;

var wsStream;
var wsComm;

// before sending audio data, we could also sending metadata for its
// number of buffer will be sent
// maybe, duration calculated on the server
// ...

let audioController = {
    ctx: constructAudioContext(),
    cache: [],
    backupCache: [],
    reqThresholdDuration: 0,
    uuid: '1234-5678',
    reqTimePoint: 0,
    bufferedDuration: 0,
    playedBufferDuration: 0,
    init: false,
    running: true
};

let bufferState = {
    maxPartDuration: 5,
    prevDuration: 0,
    bufferCheckPoint: 0,
    firstCall: true,
    some: 0,
    thresholdDuration: 0,
    isResume: false,
    newPrepareCalled: false
};

function constructAudioContext() {
    let ctx = new AudioContext();
    ctx.onstatechange = function() {
        // console.log(ctx.state);
    };

    return ctx;
}

function connect() {
    wsStream = new WebSocket('ws://localhost:8080/streaming');

    wsStream.onmessage = function(ev) {
        let json = JSON.parse(ev.data);
        if (
            json.isEnded &&
            (!audioController.cache.length || bufferState.firstCall)
        ) {
            bufferState.firstCall = false;
            prepareAudio(bufferState.prevDur);
            return;
        }

        json.data = base64ToArrayBuffer(json.data);
        audioController.ctx
            .decodeAudioData(withWaveHeader(json.data, 2, 44100), buffer => {
                console.log('decoded');
                audioController.cache.push(buffer);
                audioController.bufferedDuration += buffer.duration;
                bufferState.thresholdDuration += buffer.duration;

                // prepare the audio before play it
                if (
                    json.lastBuffer &&
                    (!audioController.cache.length || bufferState.firstCall)
                ) {
                    console.log('onmsg:', 'call to prepare');
                    bufferState.firstCall = false;
                    prepareAudio(bufferState.prevDur);
                }
            })
            .catch(console.error);
    };
}

function requestAudioChunk() {
    let reqForm = {
        uuid: audioController.uuid,
        timePoint:
            audioController.reqTimePoint +
            Math.round(audioController.bufferedDuration)
    };

    wsStream.send(JSON.stringify(reqForm));
}

function prepareAudio(prevDuration) {
    let timeCounter = 0;
    let bufferPart = [];
    let cache = audioController.cache;

    while (cache.length) {
        let buffer = cache.shift();
        audioController.backupCache.push(buffer);
        bufferPart.push(buffer);

        timeCounter += buffer.duration;
        bufferState.some += buffer.duration;
        if (timeCounter >= bufferState.maxPartDur || !cache.length) {
            // save the state
            let next = Math.floor(timeCounter - 1);
            bufferState.prevDur = next;

            (function(part, timeout, nextDuration) {
                setTimeout(function() {
                    bufferState.buffCheckoint = Date.now();
                    bufferState.newPrepareCalled = false;

                    playAudio(part);
                    console.log('time out', timeout, 'next', nextDuration);

                    if (
                        bufferState.some >= (bufferState.thresholdDuration /= 2)
                    ) {
                        bufferState.some = 0;
                        requestAudioChunk();
                        console.log(
                            'requesting',
                            bufferState.some,
                            bufferState.thresholdDuration
                        );
                    }

                    if (audioController.running && !bufferState.isResume) {
                        console.log('continuous call');
                        prepareAudio(nextDuration);
                    } else {
                        console.log('--- new call ---');
                        bufferState.isResume = false;
                    }
                }, timeout * 1000);
            })(bufferPart, prevDuration, next);

            break;
        }
    }
}

function togglePlayAudio() {
    if (!audioController.init) {
        audioController.init = true;
        requestAudioChunk();
        return;
    }

    let ctx = audioController.ctx;
    if (ctx.state === 'running') {
        ctx.suspend().then(function() {
            audioController.running = false;

            bufferState.buffCheckoint = Date.now();
            // console.log('paused');
        });
    } else if (ctx.state === 'suspended') {
        ctx.resume().then(function() {
            audioController.running = true;

            // when resume in between the timeout duration
            if (
                Date.now() - bufferState.buffCheckoint <
                bufferState.prevDur * 1000
            ) {
                bufferState.isResume = true;
            }

            if (!bufferState.newPrepareCalled) {
                bufferState.newPrepareCalled = true;
                prepareAudio(bufferState.prevDur);
            }
            // console.log('resumed');
        });
    }
}

function playAudio(bufferArr) {
    let chunkTimeout = audioController.playedBufferDuration;
    // console.log(chunkTimeout);
    while (bufferArr.length) {
        console.log('playing');
        let buffer = bufferArr.shift();

        let source = audioController.ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(audioController.ctx.destination);
        source.start(chunkTimeout);

        chunkTimeout += buffer.duration;
        audioController.playedBufferDuration += buffer.duration;
    }
}

(function() {
    let count = 0;
    let backup = audioController.backupCache;
    function pollForBufferRequest() {
        if (!audioController.running) return;

        count++;
        console.log(count, audioController.bufferedDuration);
        if (count >= audioController.reqThresholdDuration) {
            let tempCount = 0;
            while (Math.round(tempCount) < count && backup.length) {
                tempCount += backup.shift().duration;
            }
            count = 0;
            // ... this is causing some problem ...
            requestAudioChunk();
        }
    }

    // setInterval(pollForBufferRequest, 1000);
})();
