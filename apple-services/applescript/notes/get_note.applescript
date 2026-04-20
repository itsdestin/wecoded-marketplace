on run argv
    if (count of argv) < 1 then error "get_note.applescript requires: <note-id>"
    set noteId to item 1 of argv
    tell application "Notes"
        set target_ to note id noteId
        set nName to name of target_
        set nBody to body of target_
        set nMod to modification date of target_
    end tell
    -- Return raw (not JSON) — wrapper will wrap.
    -- Format: id\tname\tISO-modified\tHTML-body
    return noteId & tab & nName & tab & (my iso(nMod)) & tab & nBody
end run

on iso(d)
    set {year_, month_, day_, hour_, min_, sec_} to {year of d, month of d as integer, day of d, hour of d, minutes of d, seconds of d}
    return (year_ as string) & "-" & my pad(month_) & "-" & my pad(day_) & "T" & my pad(hour_) & ":" & my pad(min_) & ":" & my pad(sec_)
end iso

on pad(n)
    if n < 10 then return "0" & n
    return n as string
end pad
