on run argv
    tell application "Notes"
        set folderList to folders
        set output to "["
        set first_ to true
        repeat with f in folderList
            if not first_ then set output to output & ","
            set first_ to false
            set fName to name of f
            set fCount to count of notes of f
            set output to output & "{\"name\":" & my jsonStr(fName) & ",\"note_count\":" & fCount & "}"
        end repeat
        set output to output & "]"
        return output
    end tell
end run

on jsonStr(s)
    set escaped to ""
    repeat with ch in (characters of s)
        set c to ch as string
        if c is "\"" then
            set escaped to escaped & "\\\""
        else if c is "\\" then
            set escaped to escaped & "\\\\"
        else if c is return or c is linefeed then
            set escaped to escaped & "\\n"
        else if c is tab then
            set escaped to escaped & "\\t"
        else
            set escaped to escaped & c
        end if
    end repeat
    return "\"" & escaped & "\""
end jsonStr
