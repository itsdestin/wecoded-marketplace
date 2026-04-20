# NOTICE.md

`apple-services` is MIT-licensed. It incorporates code from the following third-party Open Source projects. License texts are reproduced in full.

---

## supermemoryai/apple-mcp (MIT)

Source: https://github.com/supermemoryai/apple-mcp (repo moved from `Dhravya/apple-mcp`)

Extracts from upstream TypeScript files (`utils/notes.ts`, `utils/mail.ts`) inform the scripts in `applescript/notes/` and `applescript/mail/`. Specifically the `createNote`, `findNote`, `sendMail`, and `getMailboxesForAccount` patterns were adapted. List-returning paths were rewritten in JXA because upstream's AppleScript record-parsing returns `[]`.

Full MIT license:

```
MIT License

Copyright (c) 2025 Dhravya Shah

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## mattt/iMCP (MIT, reference only for `bin/apple-helper`)

Source: https://github.com/mattt/iMCP (repo moved from `loopwork/iMCP`)

The compiled binary `bin/apple-helper` is built from original Swift in the sibling `itsdestin/apple-helper` repo. No iMCP code is vendored byte-for-byte, but its EventKit + Contacts service patterns (`App/Services/{Calendar,Reminders,Contacts}.swift`) informed our implementations and deserve credit.

Full MIT license:

```
Copyright 2025 Mattt (https://mat.tt)

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the "Software"),
to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense,
and/or sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```
