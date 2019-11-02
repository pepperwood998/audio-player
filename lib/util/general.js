function base64ToArrayBuffer(base64) {
    let binaryStr = window.atob(base64);
    let len = binaryStr.length;
    let bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
    }

    return bytes.buffer;
}

function asyncCall(handler) {
    setTimeout(handler, 0);
}

var getFormattedTime = duration => {
    let count = 0;

    let res = '';
    while (true) {
        let mod = duration % 60;
        res = ':' + mod + res;

        duration = Math.floor(duration / 60);
        if (duration === 0) {
            res = res.substr(1);
            break;
        }
    }

    return res;
};
