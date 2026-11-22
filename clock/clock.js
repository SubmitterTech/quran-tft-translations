// The clock of this repository. GitHub's own scheduler may start a run late or not at all,
// so the time is kept here, on Cloudflare: at each scheduled time this Worker starts the
// Release workflow, signed in as the GitHub App that exists for this one purpose.

const encoder = new TextEncoder();

const base64Url = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

const encodePart = (value) => base64Url(encoder.encode(JSON.stringify(value)));

function derLength(length) {
  if (length < 0x80) return [length];
  const bytes = [];
  for (let rest = length; rest > 0; rest >>= 8) bytes.unshift(rest & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

// GitHub hands out the app's key as PKCS#1 and WebCrypto reads only PKCS#8. PKCS#8 is the
// same key behind a fixed header that says it is an RSA key.
function wrapPkcs1(pkcs1) {
  const version = [0x02, 0x01, 0x00];
  const rsaEncryption = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const octetString = [0x04, ...derLength(pkcs1.length)];
  const length = version.length + rsaEncryption.length + octetString.length + pkcs1.length;
  return new Uint8Array([0x30, ...derLength(length), ...version, ...rsaEncryption, ...octetString, ...pkcs1]);
}

function readPrivateKey(pem) {
  const match = /-----BEGIN (RSA )?PRIVATE KEY-----([\s\S]+?)-----END (RSA )?PRIVATE KEY-----/.exec(pem || '');
  if (!match) throw new Error('GITHUB_APP_PRIVATE_KEY is not a PEM private key');
  // The line breaks may have been lost, or turned into "\n", on the way into the secret.
  const base64 = match[2].replace(/\\n/g, '').replace(/[^A-Za-z0-9+/=]/g, '');
  const der = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  return match[1] ? wrapPkcs1(der) : der;
}

// What GitHub asks of the token an app proves itself with: signed with RS256, issued a
// minute in the past to allow for clocks that differ, and valid for at most ten minutes.
async function appToken(env) {
  if (!env.GITHUB_APP_CLIENT_ID) throw new Error('GITHUB_APP_CLIENT_ID is not set');
  const now = Math.floor(Date.now() / 1000);
  const claims = { iat: now - 60, exp: now + 540, iss: env.GITHUB_APP_CLIENT_ID };
  const unsigned = `${encodePart({ alg: 'RS256', typ: 'JWT' })}.${encodePart(claims)}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    readPrivateKey(env.GITHUB_APP_PRIVATE_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(unsigned));
  return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
}

// One request to GitHub. A failure that may pass on its own is tried three times here:
// nothing in Cloudflare's documentation promises that a failed scheduled time is run again.
async function github(env, token, method, path, body) {
  const address = `${env.GITHUB_API || 'https://api.github.com'}${path}`;
  for (let attempt = 1; ; attempt += 1) {
    let status = 0;
    let text = '';
    let failure;
    try {
      const response = await fetch(address, {
        method,
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          // GitHub refuses a request that does not say who is asking.
          'user-agent': 'quran-tft-translations-clock',
          'x-github-api-version': '2026-03-10',
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        // A request that hangs is given up, and counts as a failure that may pass.
        signal: AbortSignal.timeout(30000),
      });
      status = response.status;
      text = await response.text();
    } catch (error) {
      failure = error.message || String(error);
    }
    if (failure === undefined && status >= 200 && status < 300) {
      if (!text) return {};
      try {
        return JSON.parse(text);
      } catch {
        // The answer is kept out of the error, because one of the answers is a token.
        throw new Error(`${method} ${path}: the answer was not JSON`);
      }
    }
    const temporary = failure !== undefined || status >= 500 || status === 429;
    const reason = failure === undefined ? `${status} ${text.slice(0, 200)}` : failure;
    if (!temporary || attempt >= 3) throw new Error(`${method} ${path}: ${reason}`);
    await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
  }
}

async function startRelease(env) {
  const repository = env.GITHUB_REPOSITORY;
  const workflow = `/repos/${repository}/actions/workflows/${env.GITHUB_WORKFLOW}`;
  const jwt = await appToken(env);
  const installation = await github(env, jwt, 'GET', `/repos/${repository}/installation`);
  // The token for the work itself is asked for with no more than the work needs.
  const access = await github(env, jwt, 'POST', `/app/installations/${installation.id}/access_tokens`, {
    repositories: [repository.split('/')[1]],
    permissions: { actions: 'write' },
  });
  // GitHub switches a workflow off after a long quiet period in the repository, and that is
  // undone here. A workflow that somebody switched off by hand stays off.
  const { state } = await github(env, access.token, 'GET', workflow);
  if (state === 'disabled_inactivity') {
    await github(env, access.token, 'PUT', `${workflow}/enable`);
    console.log('The workflow had been disabled for inactivity and has been enabled again.');
  } else if (state !== 'active') {
    console.log(`The workflow is ${state}, so nothing was started.`);
    return;
  }
  const run = await github(env, access.token, 'POST', `${workflow}/dispatches`, { ref: env.GITHUB_REF || 'main' });
  console.log(`Started ${env.GITHUB_WORKFLOW} in ${repository}${run.html_url ? `: ${run.html_url}` : '.'}`);
}

export default {
  // An error is left to surface, so that the run shows as failed among the Worker's events.
  async scheduled(controller, env) {
    await startRelease(env);
  },
};
