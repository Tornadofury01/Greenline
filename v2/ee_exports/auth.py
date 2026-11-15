"""Saved Earth Engine sign-ins, one per account, so one machine can submit for all 6 accounts.

  python auth.py --account 3     # opens the browser: sign in as account 3's Google account (once)

The sign-in is saved to creds/acct3.json (gitignored). Scripts call init(account), which puts that account's saved
sign-in in place and starts Earth Engine with its Cloud project. These files give access to the accounts: delete
the creds/ folder when the exports are done.
"""
import argparse, json, shutil, sys
from pathlib import Path

import ee
from ee import oauth

HERE = Path(__file__).resolve().parent
CREDS = HERE / "creds"


def accounts():
    p = HERE / "accounts.json"
    if not p.exists():
        sys.exit("accounts.json missing: copy accounts.example.json and fill in each account's Cloud project id")
    return json.loads(p.read_text())


def init(account):
    acct = accounts()[str(account)]
    saved = CREDS / f"acct{account}.json"
    if saved.exists():
        default = Path(oauth.get_credentials_path())
        default.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(saved, default)
    ee.Initialize(project=acct["project"])
    return acct


def login(account):
    acct = accounts()[str(account)]
    print(f"Sign in with the Google account that owns project {acct['project']} (account {account}).")
    ee.Authenticate(force=True, auth_mode="localhost")
    CREDS.mkdir(exist_ok=True)
    shutil.copyfile(oauth.get_credentials_path(), CREDS / f"acct{account}.json")
    ee.Initialize(project=acct["project"])
    print(f"account {account}: signed in, Earth Engine works with {acct['project']}: "
          f"{ee.Number(1).add(1).getInfo() == 2}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--account", required=True)
    login(ap.parse_args().account)
