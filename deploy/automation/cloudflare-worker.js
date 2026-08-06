// Cloudflare Worker — bridges monday.com to GitHub Actions.
//
// Two independent entry points now live here:
//
//   A. POST /            — monday.com's own webhook, fired whenever
//      an item is created on the board (by its form OR by path B
//      below). Fetches the item, gets a download URL for its file,
//      and dispatches to GitHub.
//
//   B. POST /submit-fish — called directly by the "Create your fish"
//      draw tool. Creates the monday item itself (skipping monday's
//      form UI entirely) and attaches the drawing -- that's it. It
//      deliberately does NOT dispatch to GitHub itself.
//
// Why B doesn't dispatch: create_item ALSO satisfies path A's "item
// created" trigger, so monday fires this same webhook for API-
// created items too, exactly like it does for form submissions. Two
// earlier versions of this file tried to have B dispatch immediately
// AND have A detect and skip the resulting duplicate -- first via a
// KV namespace, then via a marker column read fresh from monday's
// API. Both still raced in real testing: something on monday's own
// side has a brief propagation delay between an item existing and
// its column values being reliably readable, and a fast webhook
// delivery could arrive inside that window. Removing the second
// writer entirely removes the race -- B only ever creates the item;
// A is the only thing that ever dispatches, for every item
// regardless of source, same as it always has.
//
// ── One-time setup ─────────────────────────────────────────────
// In the Cloudflare dashboard, create this Worker, then under
// Settings → Variables add these as ENCRYPTED secrets:
//   MONDAY_API_TOKEN   — from monday.com → Admin → API
//   GITHUB_TOKEN       — a GitHub personal access token with
//                        "repo" scope (Settings → Developer
//                        settings → Fine-grained tokens)
//
// And this as a plain (non-secret) variable:
//   ALLOWED_ORIGIN     — your live site's origin, e.g.
//                        https://your-domain.com (no trailing
//                        slash). Used so only your own site's pages
//                        can call /submit-fish from a browser. Leave
//                        unset during local testing and it falls
//                        back to "*".
//
// Then fill in the placeholders below: your monday board's ID and
// column IDs, and your GitHub repo owner + name.
// ────────────────────────────────────────────────────────────────

const GITHUB_OWNER = "SpectrumStudiosMTL";
const GITHUB_REPO = "spectrum-public-access";

// From the API Playground: { boards { id name } }
const MONDAY_BOARD_ID = 18423129148;

// Creator name isn't a separate column — monday's WorkForm ties its
// built-in "Name" question straight to the item's own title field,
// so it's read/written as the item's `name` directly, no column ID
// needed. Path B below does the same for consistency.

// Find these in monday: API Playground → run
//   query { boards(ids: YOUR_BOARD_ID) { columns { id title } } }
// and match each field's label to its id value below.
const COLUMN_ID_EMAIL = "emailjwi3eyeb";
const COLUMN_ID_FISH_NAME = "short_textix6o91re";
const COLUMN_ID_FILE = "filebqxounrf";
// Optional — leave as-is if you don't have a bio column; bio will
// just stay blank for automated submissions, same as it is today.
const COLUMN_ID_BIO = "";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/submit-fish") {
      return handleDirectSubmit(request, env);
    }

    if (request.method !== "POST") {
      return new Response("OK — waiting for monday.com POSTs", { status: 200 });
    }

    let body;
    try {
      body = await request.json();
    } catch (err) {
      console.error("Couldn't parse incoming request as JSON:", err);
      return new Response("OK — ignored non-JSON request", { status: 200 });
    }

    // monday.com sends a one-time "challenge" when you first add
    // the webhook URL — it must be echoed back exactly to confirm
    // the endpoint. No further action needed on this request.
    if (body.challenge) {
      return Response.json({ challenge: body.challenge });
    }

    const itemId = body.event?.pulseId;
    if (!itemId) {
      return new Response("No item ID in payload — ignoring.", { status: 200 });
    }

    try {
      const item = await fetchMondayItem(itemId, env.MONDAY_API_TOKEN);
      const creator = item.name; // the item's own title = the WorkForm's "Name" answer
      const email = getColumnText(item, COLUMN_ID_EMAIL);
      const fishName = getColumnText(item, COLUMN_ID_FISH_NAME);
      const bio = COLUMN_ID_BIO ? getColumnText(item, COLUMN_ID_BIO) : "";
      let asset = getFileAsset(item, COLUMN_ID_FILE);

      // /submit-fish creates the item and attaches its file as two
      // separate, sequential API calls -- monday's own "item
      // created" automation can fire this same webhook the instant
      // the first one succeeds, which measured in testing arrives
      // here about a second later, often before the second call has
      // finished. A few short retries covers that ordinary gap
      // instead of treating it as "no file was ever attached."
      for (let attempt = 0; !asset && attempt < 5; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const retryItem = await fetchMondayItem(itemId, env.MONDAY_API_TOKEN);
        asset = getFileAsset(retryItem, COLUMN_ID_FILE);
      }

      if (!asset) {
        return new Response("No file attached to this submission — skipping.", { status: 200 });
      }

      if (!email) {
        // Logged for visibility rather than silently dispatching a
        // submission GitHub will just reject anyway -- add_fish.py
        // requires an email to hash into creatorId.
        console.error(`Item ${itemId} has no email value -- check COLUMN_ID_EMAIL is correct.`);
        return new Response("No email found on this submission — skipping.", { status: 200 });
      }

      const downloadUrl = await fetchAssetDownloadUrl(asset.id, env.MONDAY_API_TOKEN);

      await triggerGithubAction(
        { file_url: downloadUrl, creator, email, name: fishName, bio },
        env.GITHUB_TOKEN
      );

      return new Response("Dispatched to GitHub Actions.", { status: 200 });
    } catch (err) {
      // Logged in the Cloudflare dashboard under this Worker's logs
      console.error("Fish webhook failed:", err);
      return new Response(`Error: ${err.message}`, { status: 500 });
    }
  },
};

// ── Path B: direct submission from the draw tool ──────────────────

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

async function handleDirectSubmit(request, env) {
  const cors = corsHeaders(env);

  // Browsers preflight a cross-origin request whenever it isn't a
  // "simple" one; a plain multipart/form-data POST with no custom
  // headers usually skips this, but handling it costs nothing and
  // covers browsers/setups that send it anyway.
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: cors });
  }

  let form;
  try {
    form = await request.formData();
  } catch (err) {
    return new Response("Couldn't parse form data", { status: 400, headers: cors });
  }

  const creator = (form.get("creator") || "").toString().trim();
  const email = (form.get("email") || "").toString().trim();
  const fishName = (form.get("name") || "").toString().trim();
  const bio = (form.get("bio") || "").toString().trim();
  const file = form.get("file");

  if (!creator || !email) {
    return new Response("Missing creator name or email.", { status: 400, headers: cors });
  }
  // A plain string here means no file was actually attached (form
  // fields with no matching File come back as strings, not File
  // objects) -- reject early instead of letting monday's API fail
  // less clearly further down.
  if (!file || typeof file === "string") {
    return new Response("Missing fish file.", { status: 400, headers: cors });
  }

  try {
    const itemId = await createMondayItem({ creator, email, fishName, bio }, env.MONDAY_API_TOKEN);
    // Deliberately stops here -- no download URL fetch, no GitHub
    // dispatch. monday's own "item created" automation does that,
    // same as it does for a real form submission. See the top-of-
    // file comment for why this path doesn't also dispatch itself.
    await uploadFileToColumn(itemId, file, env.MONDAY_API_TOKEN);

    return Response.json({ ok: true }, { headers: cors });
  } catch (err) {
    console.error("Direct fish submission failed:", err);
    return new Response(`Error: ${err.message}`, { status: 500, headers: cors });
  }
}

// board_id/item_name/column_values go through GraphQL variables
// here rather than being spliced into the query string -- unlike
// the numeric IDs interpolated elsewhere in this file, creator/
// email/fishName/bio are arbitrary visitor-typed text, and a stray
// quote in someone's name could otherwise break out of the query.
async function createMondayItem({ creator, email, fishName, bio }, token) {
  const columnValues = {};
  if (email) columnValues[COLUMN_ID_EMAIL] = { email, text: email };
  if (fishName) columnValues[COLUMN_ID_FISH_NAME] = fishName;
  if (bio && COLUMN_ID_BIO) columnValues[COLUMN_ID_BIO] = bio;

  const query = `mutation ($boardId: ID!, $itemName: String!, $columnValues: JSON!) {
    create_item(board_id: $boardId, item_name: $itemName, column_values: $columnValues) {
      id
    }
  }`;
  const data = await mondayGraphQL(query, token, {
    boardId: MONDAY_BOARD_ID,
    itemName: creator,
    columnValues: JSON.stringify(columnValues),
  });
  return data.data.create_item.id;
}

// File uploads are the one part of monday's API that isn't plain
// JSON -- multipart/form-data to a separate endpoint, same shape
// verified manually against the API before this was written.
async function uploadFileToColumn(itemId, fileBlob, token) {
  const form = new FormData();
  form.append(
    "query",
    `mutation ($file: File!) { add_file_to_column (item_id: ${itemId}, column_id: "${COLUMN_ID_FILE}", file: $file) { id } }`
  );
  form.append("variables[file]", fileBlob, fileBlob.name || "fish.png");
  const resp = await fetch("https://api.monday.com/v2/file", {
    method: "POST",
    headers: { Authorization: token },
    body: form,
  });
  const data = await resp.json();
  if (data.errors) {
    throw new Error("monday.com file upload error: " + JSON.stringify(data.errors));
  }
  return data.data.add_file_to_column.id; // an asset id, same as getFileAsset() returns below
}

// ── Shared by both paths ───────────────────────────────────────────

async function mondayGraphQL(query, token, variables) {
  const resp = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": token,
    },
    body: JSON.stringify(variables ? { query, variables } : { query }),
  });
  const data = await resp.json();
  if (data.errors) {
    throw new Error("monday.com API error: " + JSON.stringify(data.errors));
  }
  return data;
}

async function fetchMondayItem(itemId, token) {
  const query = `query {
    items(ids: [${itemId}]) {
      name
      column_values {
        id
        text
        value
      }
    }
  }`;
  const data = await mondayGraphQL(query, token);
  return data.data.items[0];
}

function getColumnText(item, columnId) {
  const col = item.column_values.find((c) => c.id === columnId);
  return col ? col.text : "";
}

function getFileAsset(item, columnId) {
  const col = item.column_values.find((c) => c.id === columnId);
  if (!col || !col.value) return null;
  const parsed = JSON.parse(col.value);
  const file = parsed.files?.[0];
  return file ? { id: file.assetId } : null;
}

async function fetchAssetDownloadUrl(assetId, token) {
  const query = `query {
    assets(ids: [${assetId}]) {
      public_url
    }
  }`;
  const data = await mondayGraphQL(query, token);
  return data.data.assets[0].public_url;
}

async function triggerGithubAction(payload, token) {
  const resp = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/dispatches`,
    {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "feeling-fishy-worker",
      },
      body: JSON.stringify({
        event_type: "new-fish",
        client_payload: payload,
      }),
    }
  );
  if (!resp.ok) {
    throw new Error(`GitHub dispatch failed: ${resp.status} ${await resp.text()}`);
  }
}
