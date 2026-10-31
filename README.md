# School Attendance System

Teachers and the admin log in, mark attendance, and parents of absent students get an SMS automatically.

## Run it

1. Install Node.js 22.5 or newer (https://nodejs.org).
2. In this folder run: `npm install`
3. Copy `.env.example` to `.env` and edit it (set `JWT_SECRET`, `SCHOOL_NAME`, `ADMIN_PASSWORD`).
4. Run: `npm start`
5. Open http://localhost:3000 and log in as `admin` (password = `ADMIN_PASSWORD`, or the one printed in the console on first run).

Keep `SMS_PROVIDER=console` while testing. Messages are then only printed in the console, nothing is sent.

## First-time setup (as admin)

1. **Students tab**: paste your students as CSV (`name,roll,class,parent_name,parent_phone`), about 250 lines at once works fine.
2. **Teachers tab**: create a login for each teacher and type the classes they handle (for example `8A,8B`). A teacher can only see and mark those classes.
3. Teachers log in, choose the date and class, mark students and press **Save**. SMS goes out to parents of absent students.
4. Admin can see all SMS results and retry failed ones in **SMS log**, mark teacher attendance, and view an attendance report.

Each student gets at most one SMS per day, even if the teacher saves twice.

## Turning on real SMS (India)

TRAI rules require DLT registration before any SMS provider will deliver messages:

1. Register your school as an entity on a DLT portal (Jio, Airtel, Vodafone-Idea, BSNL and others offer one). Approval can take a few days.
2. Register a sender ID (6 letters, for example `MYSCHL`).
3. Register this message template and get it approved. `{#var#}` marks the variables:
   `Dear Parent, your child {#var#} of class {#var#} was absent on {#var#}. - {#var#}`
4. Create an account with Fast2SMS or MSG91, add the approved template, and put the keys into `.env`:
   - Fast2SMS: `SMS_PROVIDER=fast2sms` plus `FAST2SMS_API_KEY`, `FAST2SMS_SENDER_ID`, `FAST2SMS_MESSAGE_ID`
   - MSG91: `SMS_PROVIDER=msg91` plus `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`
5. Test with one student (your own number) before using it for everyone.

The variable order is student name, class, date, school name. It must match your approved template. The provider API calls are in `sms.js`. Check the provider's current documentation, because their APIs can change.

## Putting it online for the school

- Host it on a small server (a VPS or a service like Render or Railway) with HTTPS, and set `NODE_ENV=production`.
- Keep `school.db` on persistent storage and back it up regularly (copy the file daily).
- Never share `.env`. It holds your secret and SMS keys.
- Change the admin password after the first login (Change password button).
- This stores children's names and parents' phone numbers. Get the principal's approval and limit admin access.

## Files

- `server.js` : web server and API
- `db.js` : database tables (SQLite file `school.db`, uses the database built into Node.js)
- `sms.js` : SMS sending (console, Fast2SMS, MSG91)
- `public/index.html` : the website
- `DEPLOY.md` : step-by-step guide to put the system online (Render)
- `render.yaml` : hosting settings used by Render
