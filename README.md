<p align="center"><img src="icons/icon-512.png" width="128" alt="BookNote logo"></p>

# BookNote

A notebook for books, fields and cards with images, notes and tags. Everything is saved on your own device, no account needed.

## Links
- **Open the web app:** https://ender909v1.github.io/BookNote/
- **Get the app for PC or Android:** https://ender909v1.github.io/BookNote/download.html
- **Download for PC (.zip):** https://github.com/Ender909v1/BookNote/archive/refs/heads/main.zip

## Open it
- **Web / installed app:** open the web link in Chrome or Edge (PC) or Chrome (Android), then choose **Install app**.
  It gets its own icon and window and works offline.
- **From the files:** unzip the download and double-click `index.html` (best in **Chrome** or **Edge**).

Each of these keeps its own data. To move books between them (for example PC → phone), use **Backup all** and **Import**.

## Where your data is saved
- **Automatically** in the browser's local database (IndexedDB) on this PC. It handles images well and survives restarts.
  Keep opening the app the same way (the same `index.html` in the same browser) — another browser has its own separate storage.
- **Backup to Documents:** click **Backup all** (front page) or **Export to PC** (inside a book / ⋮ menu).
  Chrome/Edge open a save dialog starting in your *Documents* folder; other browsers download the `.json` file.
- **Restore / add from PC:** click **Import** or the **+** tile → *Import from PC…* and pick a `.json` file.
  Imported books are added as new copies; nothing gets overwritten.

Clearing your browser's "site data" deletes the local database, so make a backup now and then.

## Images
- Added images are **copied in as the original file**: same format (PNG stays PNG), same quality, same file name.
  Deleting or moving the file on your PC doesn't affect BookNote. Formats the browser can't show (e.g. HEIC, TIFF)
  are refused with a message — convert them to JPG/PNG first.
- The library and card rows use a small preview copy so big photos stay fast; the pop-up shows the original.
- **Get an image back as a file:** open the card → **Save image** (or the cover menu → **Save cover image**).
  It saves the original file, with its original name, starting in your Pictures folder.
- Backups (`.json`) contain every original image and its file name.
- **If an image is ever missing**, the card simply shows its text (a book shows only its title).
  Open the card and click **Add image again**, or pick a new image in **Edit**.

## Picks up where you left off
Close the tab and open `index.html` again: you return to the same book (or library page), with the same searches,
tag/field filters, scroll position (also each field's sideways scroll) and the card you had open.
Going Library → book → Library also keeps each page's scroll. This "last spot" is remembered per browser.

## Using it
- Front page: 4 books per row, 3 rows per page; the **+** tile creates a new book or imports one.
  Type a page number between the arrows to jump. Search finds books by title and by the text/tags inside them.
- Inside a book: ✎ renames it; **Add field** creates a named row of cards.
- **Reorder fields:** hold the **☰** handle at the left of a field's name and drag it up or down
  (works with mouse and touch; the page scrolls when you drag near the top or bottom).
  With the keyboard, focus the ☰ handle and press ↑ / ↓.
- **Search the whole book** with the bar under the title (press `/` to jump to it). It looks through every field's
  cards (text, notes, tags and field names; all typed words must match, in any order) and hides fields with no hits.
  Narrow it further with the field picker and the **Tags ▾** dropdown. Matches are highlighted.
  Click a tag inside an opened card to filter the whole book by it.
- Each field also has its own search box and **Tags ▾** dropdown, which stack on top of the book-wide one.
- **Tag dropdowns** (filters and the card editor): tick existing tags (numbers = how many cards use them), or type to
  narrow the list; ↑ ↓ and Enter work too. **+ Add** is always offered for what you typed: a new tag is created,
  or if that tag already exists, the existing one is picked instead (no duplicates). Tags added from a filter
  are kept on the book's tag list even before any card uses them; an unused tag shows × to delete it.
- Cards: text is required; image, note and tags are optional. Paste, drop or click to add an image.
  Click a card to open it large; use ← → to move between cards.
