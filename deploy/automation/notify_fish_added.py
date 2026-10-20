#!/usr/bin/env python3
"""
notify_fish_added.py -- emails a fish's creator once their submission
PR actually merges (the real "added to the pond" moment -- a
submission might instead get rejected/closed, so this fires on merge,
not on the original submission).

Fired by notify-fish-added.yml on a fish-submission PR closing as
merged. The PR body carries only a monday.com item ID (see
add-fish.yml) -- never the raw email itself, since this repo is
public -- so this re-fetches the email straight from monday.com right
when it's actually needed, the same way the Worker already does at
submission time.
"""

import os
import re
import sys

import requests

from fish_pipeline import creator_id_from_email, fail, first_name_only

MONDAY_API_URL = "https://api.monday.com/v2"
# Same column ID cloudflare-worker.js uses (COLUMN_ID_EMAIL) -- keep
# these in sync if that column is ever moved on the monday board.
COLUMN_ID_EMAIL = "emailjwi3eyeb"

RESEND_API_URL = "https://api.resend.com/emails"
# Same verified domain the FilmLab portal already sends from
# (lib/email/resend.ts) -- no new domain to verify.
FROM_ADDRESS = "Spectrum Public Access <notifications@productionsspectrum.com>"

FEELING_FISHY_URL = "https://spectrumpublicaccess.com/feeling-fishy/"
FILMLAB_URL = "https://spectrumpublicaccess.com/filmlab/login"

ITEM_ID_PATTERN = re.compile(r"monday-item-id:\s*(\d+)")


def extract_item_id(pr_body):
    match = ITEM_ID_PATTERN.search(pr_body or "")
    return match.group(1) if match else None


def fetch_monday_item(item_id, token):
    query = f"""query {{
      items(ids: [{item_id}]) {{
        name
        column_values {{
          id
          text
        }}
      }}
    }}"""
    resp = requests.post(
        MONDAY_API_URL,
        json={"query": query},
        headers={"Authorization": token, "Content-Type": "application/json"},
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    items = (data.get("data") or {}).get("items") or []
    return items[0] if items else None


def column_text(item, column_id):
    for col in item.get("column_values", []):
        if col["id"] == column_id:
            return (col.get("text") or "").strip()
    return ""


def build_email(creator_name, creator_id):
    first = first_name_only(creator_name) or "there"
    fish_link = f"{FEELING_FISHY_URL}?fish={creator_id}"

    text = f"""Hi {first},

Congrats! Your fish is now swimming in the pond. Click the link below to find your fish:
{fish_link}

While you're here -- if you're into filmmaking or animation, FilmLab is Spectrum's free home for young filmmakers and animators. A free account gets you your own portfolio (which you can even share as your own website), the full Watch List, and more -- no program enrollment needed.
{FILMLAB_URL}


Bonjour {first},

Félicitations! Votre poisson nage maintenant dans l'étang. Cliquez sur le lien ci-dessous pour trouver votre poisson :
{fish_link}

Pendant que vous êtes ici -- si le cinéma ou l'animation vous intéresse, FilmLab est la maison gratuite de Spectrum pour les jeunes cinéastes et animateurs. Un compte gratuit vous donne votre propre portfolio (que vous pouvez même partager comme votre propre site web), la liste de films complète, et plus encore -- aucune inscription à un programme requise.
{FILMLAB_URL}
"""

    html = f"""
<div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#121a35;line-height:1.5;">
  <p>Hi {first},</p>
  <p><strong>Congrats! Your fish is now swimming in the pond.</strong> Click below to find your fish:</p>
  <p><a href="{fish_link}" style="display:inline-block;padding:12px 24px;border-radius:999px;background:#fdd55d;color:#121a35;font-weight:bold;text-decoration:none;">View your fish</a></p>
  <p>While you're here -- if you're into filmmaking or animation, FilmLab is Spectrum's free home for young filmmakers and animators. A free account gets you your own portfolio (which you can even share as your own website), the full Watch List, and more -- no program enrollment needed.</p>
  <p><a href="{FILMLAB_URL}" style="color:#224e8b;font-weight:bold;">Join FilmLab, free →</a></p>

  <hr style="border:none;border-top:1px solid #e0e0e0;margin:28px 0;">

  <p>Bonjour {first},</p>
  <p><strong>Félicitations! Votre poisson nage maintenant dans l'étang.</strong> Cliquez ci-dessous pour trouver votre poisson :</p>
  <p><a href="{fish_link}" style="display:inline-block;padding:12px 24px;border-radius:999px;background:#fdd55d;color:#121a35;font-weight:bold;text-decoration:none;">Voir votre poisson</a></p>
  <p>Pendant que vous êtes ici -- si le cinéma ou l'animation vous intéresse, FilmLab est la maison gratuite de Spectrum pour les jeunes cinéastes et animateurs. Un compte gratuit vous donne votre propre portfolio (que vous pouvez même partager comme votre propre site web), la liste de films complète, et plus encore -- aucune inscription à un programme requise.</p>
  <p><a href="{FILMLAB_URL}" style="color:#224e8b;font-weight:bold;">Rejoindre FilmLab, gratuitement →</a></p>
</div>
"""
    return text, html


def send_email(to_email, text, html, api_key):
    resp = requests.post(
        RESEND_API_URL,
        json={
            "from": FROM_ADDRESS,
            "to": [to_email],
            "subject": "Your fish is in the pond! / Votre poisson est dans l'étang!",
            "text": text,
            "html": html,
        },
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        timeout=15,
    )
    if not resp.ok:
        fail(f"Resend returned {resp.status_code}: {resp.text}")


def main():
    pr_body = os.environ.get("PR_BODY", "")
    monday_token = os.environ.get("MONDAY_API_TOKEN")
    resend_key = os.environ.get("RESEND_API_KEY")

    item_id = extract_item_id(pr_body)
    if not item_id:
        # A PR from before this feature existed, or a manual test run
        # with no item_id input -- nothing to notify, not an error.
        print("No monday-item-id in this PR's body -- skipping notification.")
        return
    if not monday_token or not resend_key:
        fail("MONDAY_API_TOKEN or RESEND_API_KEY is not set.")

    item = fetch_monday_item(item_id, monday_token)
    if not item:
        print(f"monday.com item {item_id} not found (deleted since?) -- skipping notification.")
        return

    email = column_text(item, COLUMN_ID_EMAIL)
    if not email:
        print(f"monday.com item {item_id} has no email on file -- skipping notification.")
        return

    creator_id = creator_id_from_email(email)
    text, html = build_email(item.get("name", ""), creator_id)
    send_email(email, text, html, resend_key)
    print(f"Sent 'added to the pond' email for creatorId {creator_id}.")


if __name__ == "__main__":
    main()
