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
