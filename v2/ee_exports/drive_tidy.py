"""Merge an account's duplicate 'fieldshift_v2' Drive folders into the oldest one (EE makes a new folder when several
exports start before the folder exists). Optionally move files matching a prefix to the Drive trash (restorable 30 days).

  python drive_tidy.py --account 1 [--trash-prefix prism_]
"""
import argparse
import ee
from googleapiclient.discovery import build
import auth, config

ap = argparse.ArgumentParser()
ap.add_argument("--account", required=True)
ap.add_argument("--trash-prefix", default=None)
a = ap.parse_args()
auth.init(a.account)
drive = build("drive", "v3", credentials=ee.data.get_persistent_credentials(), cache_discovery=False)
name = config.DEST["folder"]
folders = sorted((f for f in drive.files().list(q=f"name='{name}' and mimeType='application/vnd.google-apps.folder' and trashed=false",
                                                fields="files(id,createdTime,ownedByMe)").execute()["files"] if f["ownedByMe"]),
                 key=lambda f: f["createdTime"])   # folders shared in by other accounts are left alone
if not folders:
    raise SystemExit(f"account {a.account}: no '{name}' folder yet")
keep = folders[0]["id"]


def files_in(fid):
    out, tok = [], None
    while True:
        r = drive.files().list(q=f"'{fid}' in parents and trashed=false", fields="nextPageToken,files(id,name,ownedByMe)",
                               pageSize=1000, pageToken=tok).execute()
        out += r["files"]; tok = r.get("nextPageToken")
        if not tok:
            return out


moved = 0
for f in folders[1:]:
    for x in files_in(f["id"]):
        drive.files().update(fileId=x["id"], addParents=keep, removeParents=f["id"], fields="id").execute()
        moved += 1
    drive.files().update(fileId=f["id"], body={"trashed": True}).execute()
trashed = 0
if a.trash_prefix:
    for x in files_in(keep):
        if x["name"].startswith(a.trash_prefix) and x["ownedByMe"]:   # only this account's own files
            drive.files().update(fileId=x["id"], body={"trashed": True}).execute()
            trashed += 1
n = len(files_in(keep))
print(f"account {a.account}: merged {len(folders)} folders into one ({moved} files moved), trashed {trashed} '{a.trash_prefix}' files, "
      f"{n} files now in {name}: https://drive.google.com/drive/folders/{keep}")
