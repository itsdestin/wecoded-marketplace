on run argv
    if (count of argv) < 2 then error "update_note.applescript requires: <id> <body> [mode=replace|append|prepend]"
    set noteId to item 1 of argv
    set newBody to item 2 of argv
    set mode to "replace"
    if (count of argv) >= 3 then set mode to item 3 of argv

    tell application "Notes"
        set target_ to note id noteId
        if mode is "replace" then
            set body of target_ to newBody
        else if mode is "append" then
            set body of target_ to (body of target_) & "<br>" & newBody
        else if mode is "prepend" then
            set body of target_ to newBody & "<br>" & (body of target_)
        else
            error "Unknown mode: " & mode
        end if
        set nName to name of target_
    end tell
    return "{\"id\":\"" & noteId & "\",\"name\":\"" & nName & "\"}"
end run
