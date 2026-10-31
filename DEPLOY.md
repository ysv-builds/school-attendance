# Putting the attendance system online (Render)

Result: teachers and the principal open one web address (https://…onrender.com) on any phone or computer.

Approximate cost (check https://render.com/pricing before paying, prices change):
the smallest paid web service is about $7 per month, plus about $0.25 per GB per month for the disk
(this project asks for 1 GB, which is plenty for a school). A free plan will not work, because it
cannot keep the database file safely.

## 1. Put the project on GitHub

1. Create a free account at https://github.com and make a **new private repository**.
2. Extract `school-attendance-v3.zip` on your computer.
3. In the new repository click **Add file → Upload files**, drag in everything from inside the extracted
   `school-attendance` folder (including the `public` folder), and click **Commit changes**.
   Do not upload `.env`, `school.db` or `node_modules` if they exist.

## 2. Create the website on Render

1. Create an account at https://render.com and connect your GitHub account.
2. Click **New → Blueprint**, pick your repository. Render reads `render.yaml` automatically.
3. When asked, enter:
   - `SCHOOL_NAME`: the school's name (used in SMS messages)
   - `ADMIN_PASSWORD`: a strong password for the admin login (the principal or school office should choose it)
4. Review the monthly price shown and click **Apply / Deploy**. The first build takes a few minutes.
5. Open the address Render shows (it ends with `.onrender.com`) and log in as `admin`.

## 3. Set up the school

- **Students** tab: paste the student list as CSV (`name,roll,class,parent_name,parent_phone`).
- **Teachers** tab: create a login for each teacher and enter the classes they handle (for example `8A,8B`).
- Teachers then log in on their phones and mark attendance each morning.

## 4. Turn on real SMS (until then it is TEST MODE)

While `SMS_PROVIDER=console`, nothing is sent. The attendance screen says "TEST MODE" after saving so nobody is misled.

1. The school registers on a DLT portal, gets a sender ID, and gets this template approved:
   `Dear Parent, your child {#var#} of class {#var#} was absent on {#var#}. - {#var#}`
2. Create an account with Fast2SMS or MSG91 and add the approved template there.
3. In the Render dashboard open your service, go to **Environment**, and set:
   - Fast2SMS: `SMS_PROVIDER=fast2sms`, `FAST2SMS_API_KEY`, `FAST2SMS_SENDER_ID`, `FAST2SMS_MESSAGE_ID`
   - MSG91: `SMS_PROVIDER=msg91`, `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`
4. Save. Render restarts the site. Test with one student using your own phone number, then check the **SMS log** tab.

## 5. Keep it safe

- Log in as admin and click **Download backup** every week. Keep the file somewhere safe (it contains student data).
- Only the school office should know the admin password. Teachers get their own logins.
- Get the principal's written approval for storing student and parent details.

## 6. Changing the app later

Replace the changed file in your GitHub repository. Render redeploys automatically and keeps the database on the disk.
