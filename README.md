# Friendsgiving- Around the World edition! Civ 6

A mobile-friendly event site for Civilization VI registration, an international potluck, beginner resources, and optional Pompeii-inspired costumes.

## Registration storage

The live site uses Supabase on its free plan. Guests do not need email addresses or accounts. The site creates an anonymous guest session in each browser, then saves sign-ups to a shared database so everyone can view them. Guests can update their entries and switch their own team assignment from the browser they used to sign up.

The browser code uses the project's publishable key. Row-level security restricts changes and removals to the guest session that created a registration. Never put a Supabase secret key in this public repository.

## Files

- `index.html`, `styles.css`, and `app.js` make up the site.
- `supabase-config.js` contains the Supabase project URL and publishable key.
- `images/` contains the party and costume reference photos.

The site is hosted on GitHub Pages and uses the Supabase JavaScript client from jsDelivr.

## Pages

- Civ VI player or watcher registration and team assignments
- Potluck registration with category counts and a shared list of who is bringing what
- Civilization VI learning and purchase links
- Optional Pompeii costume references, shopping searches, and DIY videos

The Supabase Free plan includes usage limits and may pause projects after inactivity. Check the current [Supabase pricing page](https://supabase.com/pricing) for plan details.
