#!/bin/bash
# Открываем в Safari с принудительной очисткой кэша
osascript << 'EOF'
tell application "Safari"
    activate
    tell application "System Events"
        keystroke "n" using command down
    end tell
    delay 1
    open location "https://rishatkznai.github.io/rental-management/"
end tell
EOF
