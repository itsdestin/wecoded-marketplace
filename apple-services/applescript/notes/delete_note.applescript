on run argv
    if (count of argv) < 1 then error "delete_note.applescript requires: <id>"
    set noteId to item 1 of argv
    tell application "Notes"
        delete note id noteId
    end tell
    return "{\"ok\":true}"
end run
