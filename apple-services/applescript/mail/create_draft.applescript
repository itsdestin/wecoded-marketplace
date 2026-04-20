on run argv
    if (count of argv) < 3 then error "create_draft.applescript requires: <to-csv> <subject> <body> [cc-csv] [bcc-csv]"
    set recipientList to item 1 of argv
    set msgSubject to item 2 of argv
    set msgBody to item 3 of argv
    set ccList to ""
    set bccList to ""
    if (count of argv) >= 4 then set ccList to item 4 of argv
    if (count of argv) >= 5 then set bccList to item 5 of argv

    tell application "Mail"
        set newMsg to make new outgoing message with properties {subject:msgSubject, content:msgBody, visible:true}
        tell newMsg
            repeat with r in (my splitCSV(recipientList))
                if r is not "" then
                    make new to recipient at end of to recipients with properties {address:r}
                end if
            end repeat
            repeat with r in (my splitCSV(ccList))
                if r is not "" then
                    make new cc recipient at end of cc recipients with properties {address:r}
                end if
            end repeat
            repeat with r in (my splitCSV(bccList))
                if r is not "" then
                    make new bcc recipient at end of bcc recipients with properties {address:r}
                end if
            end repeat
            save
            set draftId to id of it
        end tell
    end tell
    return "{\"id\":\"" & draftId & "\"}"
end run

on splitCSV(s)
    if s is "" then return {}
    set AppleScript's text item delimiters to ","
    set parts to text items of s
    set AppleScript's text item delimiters to ""
    return parts
end splitCSV
