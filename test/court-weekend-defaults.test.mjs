import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const admin=fs.readFileSync(new URL('../adm/index.html',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('../supabase/migrations/20261005190121_weekend_court_defaults.sql',import.meta.url),'utf8');
const fn=(source,name)=>source.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0];
function setup(){
  const ctx=vm.createContext({opsData:{courtScheduleDays:[]},courtScheduleDays:[],courtNames:['Quadra 1','Quadra 2'],clientCourtNames:['Quadra 1','Quadra 2'],courtDefaultTimes:['14:00','15:00','16:00','17:00','18:00','19:00','20:00'],clientCourtDefaultTimes:['14:00','15:00','16:00','17:00','18:00','19:00','20:00'],plainDateDayOfWeek:d=>new Date(d+'T12:00:00Z').getUTCDay()});
  for(const name of ['courtDefaultTimesForDate','courtScheduleForDate','normalizeCourtTimes','courtTimesForDate','isWeekendDate','isFixedCourtBlock','mapCourtScheduleDayRow']) vm.runInContext(fn(admin,name),ctx);
  for(const name of ['normalizeClientCourtTimes','clientCourtTimesForDate','clientCourtScheduleForDate','isClientCourtWeekend','isClientCourtFixedBlock']) vm.runInContext(fn(app,name),ctx);
  return ctx;
}
test('admin and client agree: Sunday 07-20 inclusive hourly; Saturday unchanged',()=>{
  const ctx=setup();
  for(const date of ['2026-10-10','2026-10-11','2026-10-18']){
    const times=ctx.courtTimesForDate(date);
    assert.equal(JSON.stringify(times),JSON.stringify(ctx.clientCourtTimesForDate(date)));
    assert.equal(times.length,date==='2026-10-10'?7:14);
    assert.equal(times[0],date==='2026-10-10'?'14:00':'07:00');assert.equal(times.at(-1),'20:00');
  }
});
test('weekend blocks both courts 16/17 only; date and court-specific overrides persist through mapping',()=>{
  const ctx=setup();
  for(const date of ['2026-10-10','2026-10-11','2026-10-12']) for(const court of ctx.courtNames) for(const time of ['07:00','15:00','16:00','17:00','18:00','20:00']){
    const expected=date!=='2026-10-12'&&['16:00','17:00'].includes(time);
    assert.equal(ctx.isFixedCourtBlock(date,court,time),expected);
    assert.equal(ctx.isClientCourtFixedBlock(date,court,time),expected);
  }
  const config={schedule_date:'2026-10-11',enabled:true,slot_times:['08:30:00','16:00:00'],released_default_slots:['Quadra 1|16:00']};
  ctx.courtScheduleDays.push(config);ctx.opsData.courtScheduleDays.push(ctx.mapCourtScheduleDayRow(config));
  assert.equal(ctx.isFixedCourtBlock('2026-10-11','Quadra 1','16:00'),false);
  assert.equal(ctx.isClientCourtFixedBlock('2026-10-11','Quadra 1','16:00'),false);
  assert.equal(ctx.isFixedCourtBlock('2026-10-11','Quadra 2','16:00'),true);
  assert.equal(ctx.isFixedCourtBlock('2026-10-18','Quadra 1','16:00'),true);
  assert.equal(JSON.stringify(ctx.courtTimesForDate('2026-10-11')),JSON.stringify(['08:30','16:00']));
  assert.equal(JSON.stringify(ctx.clientCourtTimesForDate('2026-10-11')),JSON.stringify(['08:30','16:00']));
});
test('migration preserves reservations, enforces server blocks and restricts exceptions to staff',()=>{
  assert.doesNotMatch(migration,/delete from|update public\.app_court_bookings|disable trigger/i);
  assert.match(migration,/old\.status in \('PENDENTE','CONFIRMADO'\)/);
  assert.match(migration,/before insert or update of booking_date, starts_at, court_name, status/);
  assert.match(migration,/not public\.has_club_permission\('classes'\)/);
  assert.match(migration,/security invoker set search_path = ''/);
  assert.match(migration,/court-schedule:/);
  assert.match(admin,/isFixedCourtBlock\(selectedDate, court, time\) && !findCourtBooking/);
  for(const source of [admin,app]) assert.match(source,/select=schedule_date,enabled,notes,slot_times,released_default_slots/);
});
