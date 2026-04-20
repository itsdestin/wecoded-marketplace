on run argv
    if (count of argv) < 2 then error "create_note.applescript requires: <name> <body> [folder]"
    set noteName to item 1 of argv
    set noteBody to item 2 of argv
    set folderName to ""
    if (count of argv) >= 3 then set folderName to item 3 of argv

    tell application "Notes"
        if folderName is "" then
            set newNote to make new note with properties {name:noteName, body:noteBody}
        else
            try
                set targetFolder to first folder whose name is folderName
                set newNote to make new note at targetFolder with properties {name:noteName, body:noteBody}
            on error
                error "Folder not found: " & folderName
            end try
        end if
        set noteId to id of newNote
    end tell
    return "{\"id\":\"" & noteId & "\",\"name\":\"" & noteName & "\"}"
end run
