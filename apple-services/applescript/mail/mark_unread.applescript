on run argv
    if (count of argv) < 1 then error "mark_unread.applescript requires: <message-id>"
    set msgId to item 1 of argv
    tell application "Mail"
        set foundMsg to missing value
        repeat with acct in accounts
            repeat with box in mailboxes of acct
                try
                    set foundMsg to (first message of box whose id is msgId)
                    exit repeat
                end try
            end repeat
            if foundMsg is not missing value then exit repeat
        end repeat
        if foundMsg is missing value then error "Message not found: " & msgId
        set read status of foundMsg to false
    end tell
    return "{\"ok\":true}"
end run
