// Granting microphone access, once.
//
// The capture itself runs in an offscreen document, which by design has no
// window and therefore cannot show Chrome's permission prompt. An extension
// popup is no better: it closes the moment the prompt appears, which cancels
// the request. A real tab is the only surface that can hold the prompt open
// long enough for someone to click Allow.
//
// The grant is stored against the extension's origin, so once this page has
// run the offscreen document's getUserMedia succeeds silently from then on.

const status = document.getElementById('status');

function done() {
  status.className = 'ok';
  status.textContent = 'Microphone allowed. You can close this tab and start recording.';
  document.getElementById('grant').style.display = 'none';
}

async function check() {
  try {
    const result = await navigator.permissions.query({ name: 'microphone' });
    if (result.state === 'granted') done();
  } catch { /* Not queryable in this Chrome — the button still works. */ }
}

document.getElementById('grant').onclick = async () => {
  status.className = '';
  status.textContent = 'Waiting for Chrome…';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Release it immediately: this page only exists to obtain the grant, and
    // holding the device would leave a recording indicator on for no reason.
    stream.getTracks().forEach((t) => t.stop());
    done();
  } catch (e) {
    status.className = 'err';
    status.textContent = e.name === 'NotAllowedError'
      ? 'Chrome blocked the microphone. Open chrome://settings/content/microphone and allow it for this extension, then reload this page.'
      : `Could not open the microphone: ${e.message}`;
  }
};

check();
