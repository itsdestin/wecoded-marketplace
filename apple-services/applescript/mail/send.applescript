on run argv
    if (count of argv) < 3 then error "send.applescript requires: <to-csv> <subject> <body> [cc-csv] [bcc-csv] [attach-paths-csv]"
    set recipientList to item 1 of argv
    set msgSubject to item 2 of argv
    set msgBody to item 3 of argv
    set ccList to ""
    set bccList to ""
    set attachList to ""
    if (count of argv) >= 4 then set ccList to item 4 of argv
    if (count of argv) >= 5 then set bccList to item 5 of argv
    if (count of argv) >= 6 then set attachList to item 6 of argv

    tell application "Mail"
        set newMsg to make new outgoing message with properties {subject:msgSubject, content:msgBody, visible:false}
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
            repeat with p in (my splitCSV(attachList))
                if p is not "" then
                    try
                        make new attachment with properties {file name:(POSIX file p)} at after the last paragraph
                    end try
                end if
            end repeat
            send
        end tell
    end tell
    return "{\"ok\":true}"
end run

on splitCSV(s)
    if s is "" then return {}
    set AppleScript's text item delimiters to ","
    set parts to text items of s
    set AppleScript's text item delimiters to ""
    return parts
end splitCSV
