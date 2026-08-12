/** Synthetic PowerSchool-shaped page content; never derived from school data. */
export const syntheticPowerSchoolScheduleTitle =
  'Friday, April 13, 2035 Synthetic schedule';

export function syntheticPowerSchoolScheduleBody(
  kind: 'static' | 'dynamic',
  requestedDate: string | null,
): string {
  const date = requestedDate === '2035-04-13' ? requestedDate : '2035-04-13';
  return `<section data-schedule-kind="${kind}" data-effective-date="${date}">
    <h1>Friday, April 13, 2035 Bell Schedule</h1>
    <table><tbody>
      <tr><td>Period 1</td><td>8:00 AM - 8:45 AM</td></tr>
      <tr><td>Period 2</td><td>8:50 AM - 9:35 AM</td></tr>
    </tbody></table>
  </section>`;
}
