# Puzzle Cam + Supabase

A hand-tracking photobooth (MediaPipe) that assembles a live jigsaw
puzzle. When it's solved and the user closes their fist, the photo is
saved to the local strip **and automatically uploaded to Supabase**,
where it shows up in an admin panel with login.

## Project structure

```
puzzlecam/
├── index.html              # camera app (for the kiosk/photobooth)
├── admin.html               # admin panel (login + gallery)
├── css/
│   ├── styles.css            # camera app styles
│   └── admin.css             # admin panel styles
├── js/
│   ├── app.js                 # camera logic + upload to Supabase
│   ├── admin.js                # admin panel logic
│   ├── supabaseClient.js       # shared Supabase client
│   └── supabase-config.js      # ← YOUR KEYS GO HERE
└── supabase/
    └── schema.sql             # SQL to create the table + bucket + policies
```

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) and create a new project.
2. Go to **SQL Editor** → *New query*, paste the full contents of
   `supabase/schema.sql` and run it. This creates:
   - the `public.captures` table (with RLS enabled),
   - the `puzzle-photos` Storage bucket (public for reading),
   - the policies needed so the camera can upload photos
     without a session, and only the authenticated admin can read/delete them.

## 2. Create the admin account

1. Go to **Authentication → Users → Add user**.
2. Create a user with an email and password (this will be the account you
   use to log in to `admin.html`).
3. No extra roles table is needed: any authenticated user
   on this project can view and delete captures, because
   that's how the `authenticated` policy is defined in `schema.sql`.
   If you'll have multiple admins, create one user per person from
   the same screen.

## 3. Connect the frontend

Open `js/supabase-config.js` and replace the placeholder values with
your project's own (**Project Settings → API**):

```js
export const SUPABASE_URL = "https://your-project.supabase.co";
export const SUPABASE_ANON_KEY = "your-public-anon-key";
```

> The `anon` key is public by design (it's used in the browser). The
> actual security comes from the RLS policies in step 1, not this key.

## 4. Run it

Serve the folder with any static server (it can't be opened with
`file://` because it uses ES modules and the camera requires HTTPS or
`localhost`). For example:

```bash
npx serve .
# or
python3 -m http.server 8080
```

- Camera / kiosk: `http://localhost:PORT/index.html`
- Admin panel: `http://localhost:PORT/admin.html`

For production, upload the folder as-is to any static host
(Vercel, Netlify, GitHub Pages, etc.) — no backend of your own is
needed, everything goes through Supabase.

## How the sync works

1. In `index.html`, when someone solves the puzzle and closes their
   fist, `finishShatter()` calls `uploadCaptureToCloud()`.
2. That function uploads the PNG to the `puzzle-photos` bucket and creates
   a row in `captures` with the image's public URL.
3. `admin.html` subscribes to real-time changes on the `captures`
   table (Supabase Realtime), so new photos appear
   in the panel without reloading the page.
4. If there's no connection or Supabase isn't configured, the app keeps
   working normally: the photo stays in the local strip, it just
   doesn't sync with the panel (you'll see a warning in the browser
   console and a brief "no connection to the cloud" badge).

## Security notes

- The bucket is public **for reading only** (so photos can be shown
  by URL), not for listing its contents arbitrarily.
- Anyone with the camera app can *insert* captures (it's a
  public kiosk), but only an authenticated user can *read the
  full list* or *delete* — that's why the admin panel requires login.
- If you want to fully lock down public uploads (for example, to
  run the camera only at a controlled event), you can remove the
  `"anon can insert captures"` policy and require login there too.
