window.AudioContext = window.AudioContext || window.webkitAudioContext;

var wsStream;
var wsComm;

let main = {
    ctx: constructAudioContext(),
    uuid: '1234-5678',
    cache: [],
    backupCache: []
};

let time = {
    initPoint: 0,
    totalBuffDur: 0,
    buffInCtxDur: 0,
    maxPartDur: 5,
    prevPartDur: 0,

    reqCounterDur: 0,
    reqCheckpoint: 0
};

let state = {
    init: false,
    running: false,
    isResume: false,
    onInitPrepareCalled: false,

    newPlay: false,
    onResumeBefore: false,
    lock: false,

    _: function(key, val) {
        this[key] = val;
    },
    build: function(key, val) {
        this[key] = val;
        return this;
    }
};

function constructAudioContext() {
    let ctx = new AudioContext();
    ctx.onstatechange = function() {
        // console.log(ctx.state);
    };

    return ctx;
}

let temp = 0;
function connect() {
    wsStream = new WebSocket('ws://localhost:8080/streaming');

    wsStream.onmessage = function(ev) {
        let json = JSON.parse(ev.data);
        if (json.isEnded) {
            if (!state.onInitPrepareCalled) {
                state._('onInitPrepareCalled', true);
                prepareAudio(time.prevPartDur);
            }
            return;
        }

        json.data = base64ToArrayBuffer(json.data);
        main.ctx
            .decodeAudioData(withWaveHeader(json.data, 2, 44100), buffer => {
                console.log('decoded');
                main.cache.push(buffer);
                time.totalBuffDur += buffer.duration;
                time.reqCheckpoint += buffer.duration;

                // prepare the audio before play it
                if (json.lastBuffer) {
                    if (!state.onInitPrepareCalled) {
                        state._('onInitPrepareCalled', true);
                        prepareAudio(time.prevPartDur);
                    }
                }
            })
            .catch(console.error);
    };
}

function prepareAudio(prevDuration) {
    let timeCounter = 0;
    let bufferPart = [];
    let cache = main.cache;

    while (cache.length) {
        let buffer = cache.shift();
        main.backupCache.push(buffer);
        bufferPart.push(buffer);

        timeCounter += buffer.duration;
        time.reqCounterDur += buffer.duration;
        time.reqCheckpoint -= buffer.duration;
        if (timeCounter >= time.maxPartDur || !cache.length) {
            // save the state
            let next = Math.floor(timeCounter - 1);
            time.prevPartDur = next;

            (function(part, timeout, nextDuration) {
                setTimeout(function() {
                    state.build('newPlay', true)
                        .build('onResumeBefore', false);

                    asyncCall(() => playAudio(part));
                    console.log(
                        'time out',
                        timeout,
                        'next',
                        nextDuration,
                        'some', time.reqCounterDur,
                        'two', time.reqCheckpoint
                    );
                    asyncCall(function() {
                        if (time.reqCounterDur > time.reqCheckpoint) {
                            time.reqCounterDur = 0;
                            requestAudioChunk();
                        }
                    });

                    if (state.running && !state.isResume) {
                        prepareAudio(nextDuration);
                        console.log('continuous call');
                    } else {
                        console.log('--- new call ---');
                    }

                    state.build('isResume', false)
                        .build('lock', false);
                }, timeout * 1000);
            })(bufferPart, prevDuration, next);

            break;
        }
    }
}

function togglePlayAudio() {
    if (!state.init) {
        state.build('init', true)
            .build('running', true);
        requestAudioChunk();
        return;
    }

    let ctx = main.ctx;
    if (ctx.state === 'running') {
        ctx.suspend().then(function() {
            state.build('running', false)
                .build('newPlay', false);

            // console.log('paused');
        });
    } else if (ctx.state === 'suspended') {
        ctx.resume().then(function() {
            state._('running', true);

            if (state.lock) return;
            // if resume between
            if (!state.newPlay) {
                if (!state.onResumeBefore) {
                    state.build('onResumeBefore', true)
                        .build('isResume', true);
                    prepareAudio(time.prevPartDur);
                }
            } else {
                state._('lock', true);
                prepareAudio(time.prevPartDur);
            }

            // console.log('resumed');
        });
    }
}

function requestAudioChunk() {
    let reqForm = {
        uuid: main.uuid,
        timePoint: time.initPoint + Math.round(time.totalBuffDur)
    };

    wsStream.send(JSON.stringify(reqForm));
}

function playAudio(bufferArr) {
    let chunkTimeout = time.buffInCtxDur;
    let ctx = main.ctx;
    // console.log(chunkTimeout);
    while (bufferArr.length) {
        console.log('playing');
        let buffer = bufferArr.shift();

        let source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(chunkTimeout);

        chunkTimeout += buffer.duration;
        time.buffInCtxDur += buffer.duration;
    }
}

/*
    (function() {
        let count = 0;
        let backup = main.backupCache;
        function pollForBufferRequest() {
            if (!state.running) return;

            count++;
            console.log(count, time.totalBuffDur);
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

        setInterval(pollForBufferRequest, 1000);
    })();
*/
