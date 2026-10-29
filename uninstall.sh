#!/bin/sh
# Remove the Orca Companion app made by install.sh. Your files in ~/.orca/themer are kept.
set -eu
APP="$HOME/Applications/Orca Companion.app"
if [ ! -f "$APP/Contents/MacOS/orca-companion" ]; then
  echo 'nothing to remove'
  exit 0
fi
rm -rf "$APP"
echo "removed $APP"
echo 'Open Orca from Orca.app from now on (remove the old icon from the Dock). Delete ~/.orca/themer to remove your themes too.'
