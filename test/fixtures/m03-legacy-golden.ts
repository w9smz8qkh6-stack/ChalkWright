import type { RawCourseworkItem } from '../../src/domain/coursework.js';
import type { VocabularyCandidate } from '../../src/domain/vocabulary.js';

export const legacyBellCaptures = [
  {
    id: 'table',
    title: 'Bell Schedule',
    html: '<h2>Monday, April 14, 2035</h2><table><tr><th>Period</th><th>Time</th></tr><tr><td>Period 1</td><td>7:45 AM - 8:30 AM</td></tr><tr><td>Advisory</td><td>8:35 AM - 9:00 AM</td></tr></table>',
    text: 'Bell Schedule\nMonday, April 14, 2035',
    expectedLabels: ['Period 1', 'Advisory'],
  },
  {
    id: 'card',
    title: 'Regular Day Schedule',
    html: '<article class="card"><h3>Block A</h3><p>8:00 AM - 8:50 AM</p></article><article class="card"><h3>Lunch</h3><p>11:50 AM - 12:25 PM</p></article>',
    text: 'Regular Day Schedule',
    expectedLabels: ['Block A', 'Lunch'],
  },
  {
    id: 'missing-metadata',
    title: '',
    html: '<table><tr><td>Period 3</td><td>10:00 AM - 10:45 AM</td></tr></table>',
    text: 'Period 3 10:00 AM - 10:45 AM',
    expectedLabels: ['Period 3'],
  },
  {
    id: 'noisy',
    title: 'Teacher Home',
    html: '<div class="alert">Attendance closes at 9:30 AM.</div><ul><li>Homeroom 7:40 AM - 7:55 AM</li><li>Period 1 8:00 AM - 8:45 AM</li></ul><footer>Call before 3:30 PM.</footer>',
    text: 'Teacher Home\nAttendance closes at 9:30 AM.\nHomeroom 7:40 AM - 7:55 AM\nPeriod 1 8:00 AM - 8:45 AM\nCall before 3:30 PM.',
    expectedLabels: ['Homeroom', 'Period 1'],
  },
  {
    id: 'weekly-aet',
    title: 'Bell Schedule',
    html: '<table><tr><th dayindex="2">Monday<br>04/13/2035<br>MSHS Bell Schedule Normal (F)</th><th dayindex="3">Tuesday<br>04/14/2035<br>MSHS Bell Schedule Normal (G)</th></tr></table><div class="aet_day" dayindex="2"><div class="aet_period"><b>Web Design (811.2)</b><br>B407<br>07:45 AM - 09:05 AM</div></div><div dayindex="3" class="aet_day"><div class="aet_period"><b>Robotics (506.2)</b><br>B407<br>10:45 AM - 12:05 PM</div></div>',
    text: 'Bell Schedule',
    expectedLabels: ['Web Design (811.2)'],
  },
] as const;

export const legacyCourseworkGolden: readonly RawCourseworkItem[] = [
  {
    providerCourseKey: 'provider-a',
    providerItemKey: 'r-latest',
    title: 'Recent latest',
    dueDate: '2035-04-12',
    updateTime: '2035-04-12T09:00:00Z',
    state: 'PUBLISHED',
  },
  {
    providerCourseKey: 'provider-a',
    providerItemKey: 'r-bound',
    title: 'Recent boundary',
    dueDate: '2035-04-06',
    updateTime: '2035-04-06T09:00:00Z',
    state: 'PUBLISHED',
  },
  {
    providerCourseKey: 'provider-a',
    providerItemKey: 'r-excluded',
    title: 'Too old dated',
    dueDate: '2035-04-05',
    updateTime: '2035-04-05T09:00:00Z',
    state: 'PUBLISHED',
  },
  {
    providerCourseKey: 'provider-a',
    providerItemKey: 'r-undated-old',
    title: 'Old undated',
    updateTime: '2035-03-01T09:00:00Z',
    state: 'PUBLISHED',
  },
  {
    providerCourseKey: 'provider-a',
    providerItemKey: 'u-today',
    title: 'Unit 6  Quiz',
    description:
      'Review\u00a0the practice set. Submit the quiz in Classroom. Ignore this third sentence.',
    dueDate: { year: 2035, month: 4, day: 13 },
    updateTime: '2035-04-12T12:00:00Z',
    state: 'PUBLISHED',
    workType: 'ASSIGNMENT',
    alternateLink: 'https://fixture.example.invalid/classroom/u-today',
    assignedCount: '24',
    submittedCount: 7,
    materials: [
      {
        title: ' Practice\nset ',
        url: 'https://fixture.example.invalid/material',
      },
      {
        driveFile: {
          driveFile: {
            title: ' Design\u00a0brief ',
            alternateLink: 'https://fixture.example.invalid/drive',
          },
        },
      },
      {
        youtubeVideo: {
          title: 'Demo video',
          alternateLink: 'https://fixture.example.invalid/video',
        },
      },
      {
        form: {
          title: 'Exit ticket',
          formUrl: 'https://fixture.example.invalid/form',
        },
      },
    ],
  },
  {
    providerCourseKey: 'provider-a',
    providerItemKey: 'u-bound',
    title: 'Upcoming boundary',
    dueDate: '2035-05-04',
    updateTime: '2035-04-12T11:00:00Z',
    state: 'PUBLISHED',
  },
  {
    providerCourseKey: 'provider-a',
    providerItemKey: 'u-excluded',
    title: 'Too far',
    dueDate: '2035-05-05',
    updateTime: '2035-04-12T10:00:00Z',
    state: 'PUBLISHED',
  },
  {
    providerCourseKey: 'provider-a',
    providerItemKey: 'u-undated',
    title: 'New undated',
    updateTime: '2035-04-11T09:00:00Z',
    state: 'PUBLISHED',
  },
  {
    providerCourseKey: 'provider-a',
    providerItemKey: 'deleted',
    title: 'Deleted',
    dueDate: '2035-04-14',
    state: 'DELETED',
  },
  {
    providerCourseKey: 'provider-a',
    title: 'Missing provider ID',
    dueDate: '2035-04-14',
    state: 'PUBLISHED',
  },
];

export const legacyVocabularyCandidates: readonly VocabularyCandidate[] = [
  { term: 'Input', definition: 'Data entering a system', source: 'class' },
  { term: 'input', definition: 'Duplicate loses', source: 'subject' },
  { term: 'Output', definition: 'Data leaving a system', source: 'class' },
  {
    term: 'If statement',
    definition: 'Runs code when a condition is true',
    source: 'codehs',
    keywords: ['condition'],
    pronunciation: '/if ˈsteɪtmənt/',
    partOfSpeech: 'noun',
    example: 'Use an if statement to choose a branch.',
    vietnamese: {
      term: 'câu lệnh nếu',
      definition: 'Chạy mã khi điều kiện đúng',
      example: 'Dùng câu lệnh nếu để chọn một nhánh.',
    },
    accent: 'calm',
    durationSeconds: 15,
  },
  {
    term: 'Boolean',
    definition: 'A true or false value',
    source: 'codehs',
    keywords: ['true', 'false'],
  },
] as const;
