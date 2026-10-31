// SMS sending. Choose the provider with SMS_PROVIDER in .env:
//   console   -> no real SMS, just prints the message (use this for testing)
//   fast2sms  -> Fast2SMS DLT route
//   msg91     -> MSG91 Flow API
//
// Indian regulations (TRAI/DLT): the school must register as an "entity" on a DLT portal,
// register a sender ID (header) and get the message template approved.
// The variables must be in the same order as in the approved template.
// Check your provider's current API documentation before going live.

const SCHOOL = process.env.SCHOOL_NAME || 'School';

function buildText({ student, class_name, date }) {
  // Keep this identical to your DLT-approved template (variables replaced).
  return `Dear Parent, your child ${student} of class ${class_name} was absent on ${date}. - ${SCHOOL}`;
}

async function sendConsole(phone, vars) {
  console.log(`[SMS:console] to ${phone}: ${buildText(vars)}`);
  return { ok: true, response: 'console' };
}

async function sendFast2sms(phone, vars) {
  const res = await fetch('https://www.fast2sms.com/dev/bulkV2', {
    method: 'POST',
    headers: { authorization: process.env.FAST2SMS_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      route: 'dlt',
      sender_id: process.env.FAST2SMS_SENDER_ID,
      message: process.env.FAST2SMS_MESSAGE_ID,           // template/message ID from Fast2SMS DLT section
      variables_values: `${vars.student}|${vars.class_name}|${vars.date}|${SCHOOL}`,
      numbers: phone,
      flash: 0
    })
  });
  const body = await res.text();
  let ok = res.ok;
  try { ok = ok && JSON.parse(body).return === true; } catch (_) {}
  return { ok, response: body.slice(0, 500) };
}

async function sendMsg91(phone, vars) {
  const res = await fetch('https://control.msg91.com/api/v5/flow/', {
    method: 'POST',
    headers: { authkey: process.env.MSG91_AUTH_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      template_id: process.env.MSG91_TEMPLATE_ID,
      short_url: '0',
      recipients: [{
        mobiles: '91' + phone,
        var1: vars.student, var2: vars.class_name, var3: vars.date, var4: SCHOOL
      }]
    })
  });
  const body = await res.text();
  let ok = res.ok;
  try { ok = ok && JSON.parse(body).type === 'success'; } catch (_) {}
  return { ok, response: body.slice(0, 500) };
}

const providers = { console: sendConsole, fast2sms: sendFast2sms, msg91: sendMsg91 };

async function sendAbsenceSms(phone, vars) {
  const name = (process.env.SMS_PROVIDER || 'console').toLowerCase();
  const fn = providers[name];
  if (!fn) return { ok: false, response: `Unknown SMS_PROVIDER "${name}"`, text: buildText(vars) };
  try {
    const r = await fn(phone, vars);
    return { ...r, text: buildText(vars) };
  } catch (e) {
    return { ok: false, response: String(e.message || e), text: buildText(vars) };
  }
}

module.exports = { sendAbsenceSms, buildText };
