---
description: Tell the agent that the player commented on the mod page
argument-hint: "[page path]"
---
The player left comments on the generated mod page. Read the comments before you change anything:

1. Read the page: `${1:-the *.modpage.html file under your_mods/*/.preview/}`.
2. Read the comments and the form values in the `pi-page-feedback` block at the end of that file.
3. Change the mod from the comments, following the `mod-page` skill.
4. Write the page again, and **leave out the old `pi-page-feedback` block** so the next round starts
   clean. Do not edit the old block in place.
