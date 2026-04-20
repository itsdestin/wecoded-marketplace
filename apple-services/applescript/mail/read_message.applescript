on run argv
    if (count of argv) < 1 then error "read_message.applescript requires: <message-id>"
    set msgId to item 1 of argv
    tell application "Mail"
        -- Mail message IDs are scoped to their mailbox; search across all.
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
        set msgFrom to sender of foundMsg
        set msgSubject to subject of foundMsg
        set msgDate to date sent of foundMsg
        set msgBody to content of foundMsg
    end tell
    -- TSV: id\tfrom\tsubject\tISO-date\tbody. Wrapper converts to JSON.
    return msgId & tab & msgFrom & tab & msgSubject & tab & (my iso(msgDate)) & tab & msgBody
end run

on iso(d)
    set {year_, month_, day_, hour_, min_, sec_} to {year of d, month of d as integer, day of d, hour of d, minutes of d, seconds of d}
    return (year_ as string) & "-" & my pad(month_) & "-" & my pad(day_) & "T" & my pad(hour_) & ":" & my pad(min_) & ":" & my pad(sec_)
end iso

on pad(n)
    if n < 10 then return "0" & n
    return n as string
end pad
