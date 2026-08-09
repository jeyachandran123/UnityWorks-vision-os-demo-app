/**
 * Plain-language scene description — the view for someone who does not read JSON.
 *
 * The Observations page answers *"what exactly did the platform record?"* and is
 * written for an engineer. This answers *"what is happening?"* for everyone
 * else, in sentences a manager can read at a glance:
 *
 *     Person 1 is sitting, wearing a blue top and black trousers, and
 *     carrying a phone.
 *     Person 1 has been in view for 42 seconds.
 *
 * **It is still not interpretation.** Every clause is a field Vision OS
 * reported, rewritten into English and nothing more. The rules from
 * [[insights.ts]] hold here unchanged: every sentence carries the fields it came
 * from, nothing is asserted that the platform did not report, no threshold is
 * invented, and the same objects always produce the same words.
 *
 * The limit worth understanding is what it cannot say. It cannot mention a table
 * unless the platform reported a table, and it cannot say someone is eating
 * unless `eating` was a registered attribute the model was asked to fill. Both
 * are decided by what the deployment binds — the detector's class list and the
 * attribute registry — not by this file. When the vocabulary widens, these
 * sentences widen with it and no line here changes.
 */

import type { ObjectView } from '../api/types';

export interface SceneLine {
  id: string;
  /** One sentence, plain English. */
  text: string;
  /** The Vision OS fields behind it. Never empty — the same rule as an insight. */
  cites: Array<{ field: string; value: string }>;
  objectId: string;
}

export interface SceneSummary {
  /** "One person is in view." — the whole scene in a sentence. */
  headline: string;
  lines: SceneLine[];
}

const POSTURE_WORDS: Record<string, string> = {
  standing: 'standing',
  sitting: 'sitting',
  walking: 'walking',
  crouching: 'crouching',
  lying: 'lying down',
};

/**
 * Furniture, as a phrase that attaches to a posture: "sitting **at a table**".
 *
 * `none` and `other` are absent on purpose. The platform reporting "other" means
 * it saw furniture it could not name, and "beside some furniture" is a sentence
 * that adds nothing a viewer can use — so the summary stays quiet rather than
 * padding.
 */
const FURNITURE_PHRASES: Record<string, string> = {
  table: 'at a table',
  chair: 'on a chair',
  counter: 'at a counter',
  desk: 'at a desk',
  bench: 'on a bench',
};

/** What the hands are doing, in the words a person would use. */
const ACTIVITY_WORDS: Record<string, string> = {
  eating: 'eating',
  drinking: 'drinking',
  using_phone: 'using a phone',
  reading: 'reading',
};

/** person → people, bus → buses, box → boxes. Enough for a class list. */
function plural(word: string): string {
  if (word === 'person') return 'people';
  if (/(s|x|z|ch|sh)$/.test(word)) return `${word}es`;
  return `${word}s`;
}

function words(count: number): string {
  return ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][count] ?? String(count);
}

function label(classId: string): string {
  const cleaned = classId.replace(/[._]/g, ' ');
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** Seconds a person would say out loud. Never a decimal, never a unit symbol. */
export function spokenDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  if (whole < 60) return `${whole} ${whole === 1 ? 'second' : 'seconds'}`;
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  const minutePart = `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  if (rest === 0) return minutePart;
  return `${minutePart} ${rest} ${rest === 1 ? 'second' : 'seconds'}`;
}

function attribute(object: ObjectView, key: string): string | null {
  const held = object.attributes?.[key];
  if (!held || held.value === null || held.value === undefined) return null;
  const value = String(held.value);
  return value === '' ? null : value;
}

function join(clauses: string[]): string {
  if (clauses.length === 1) return clauses[0]!;
  if (clauses.length === 2) return `${clauses[0]} and ${clauses[1]}`;
  return `${clauses.slice(0, -1).join(', ')}, and ${clauses[clauses.length - 1]}`;
}

/**
 * Describe one scene.
 *
 * Objects are sorted by id so the same state always reads the same way — a
 * summary that reshuffled between refreshes would look like new events to
 * someone watching it on a wall.
 */
export function describeScene(objects: ObjectView[]): SceneSummary {
  const ordered = [...objects].sort((a, b) => a.object_id.localeCompare(b.object_id));

  const counts = new Map<string, number>();
  for (const object of ordered) {
    counts.set(object.class_id, (counts.get(object.class_id) ?? 0) + 1);
  }

  const headline =
    ordered.length === 0
      ? 'Nothing the camera recognises is in view right now.'
      : `${capitalise(
          join(
            [...counts.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([classId, count]) =>
                count === 1
                  ? `one ${classId.replace(/[._]/g, ' ')}`
                  : `${words(count)} ${plural(classId.replace(/[._]/g, ' '))}`,
              ),
          ),
        )} in view.`;

  const lines: SceneLine[] = [];
  const seen = new Map<string, number>();

  for (const object of ordered) {
    const ordinal = (seen.get(object.class_id) ?? 0) + 1;
    seen.set(object.class_id, ordinal);
    const subject = `${label(object.class_id)} ${ordinal}`;

    const cites: Array<{ field: string; value: string }> = [
      { field: 'class_id', value: object.class_id },
      { field: 'lifecycle', value: object.lifecycle },
    ];

    // --- what they are doing ------------------------------------------------ //
    const clauses: string[] = [];

    // Posture and furniture read as one clause — "sitting at a table" — because
    // that is how a person says it. Two sentences for two fields would be
    // faithful and unreadable, and the citations keep them separable anyway.
    const posture = attribute(object, 'posture');
    const furniture = attribute(object, 'nearby_furniture');
    const furniturePhrase = furniture ? FURNITURE_PHRASES[furniture] : undefined;
    if (posture) {
      const word = POSTURE_WORDS[posture] ?? posture;
      clauses.push(furniturePhrase ? `${word} ${furniturePhrase}` : word);
      cites.push({ field: 'attributes.posture', value: posture });
      if (furniturePhrase) cites.push({ field: 'attributes.nearby_furniture', value: furniture! });
    } else if (furniturePhrase) {
      clauses.push(furniturePhrase);
      cites.push({ field: 'attributes.nearby_furniture', value: furniture! });
    }

    const upper = attribute(object, 'upper_body_colour');
    const lower = attribute(object, 'lower_body_colour');
    if (upper && lower) {
      clauses.push(`wearing a ${upper} top and ${lower} trousers`);
      cites.push({ field: 'attributes.upper_body_colour', value: upper });
      cites.push({ field: 'attributes.lower_body_colour', value: lower });
    } else if (upper) {
      clauses.push(`wearing a ${upper} top`);
      cites.push({ field: 'attributes.upper_body_colour', value: upper });
    } else if (lower) {
      clauses.push(`wearing ${lower} trousers`);
      cites.push({ field: 'attributes.lower_body_colour', value: lower });
    }

    // Activity sits after appearance and before the carried object: what someone
    // is doing belongs next to what is in their hands, and "sitting at a table,
    // eating, and wearing a blue top" puts the clothing in the wrong place.
    const activity = attribute(object, 'visible_activity');
    const activityWord = activity ? ACTIVITY_WORDS[activity] : undefined;
    if (activityWord) {
      clauses.push(activityWord);
      cites.push({ field: 'attributes.visible_activity', value: activity! });
    }

    const carrying = attribute(object, 'carrying_object');
    if (carrying && carrying !== 'none') {
      clauses.push(`carrying a ${carrying}`);
      cites.push({ field: 'attributes.carrying_object', value: carrying });
    }

    lines.push({
      id: `${object.object_id}:doing`,
      objectId: object.object_id,
      text: clauses.length
        ? `${subject} is ${join(clauses)}.`
        : `${subject} is in view. The camera has not reported anything else about them yet.`,
      cites,
    });

    // --- how long ----------------------------------------------------------- //
    const seconds = (object.last_seen_ns - object.first_seen_ns) / 1_000_000_000;
    lines.push({
      id: `${object.object_id}:duration`,
      objectId: object.object_id,
      text: `${subject} has been in view for ${spokenDuration(seconds > 0 ? seconds : 0)}.`,
      cites: [
        { field: 'first_seen_ns → last_seen_ns', value: `${Math.max(0, seconds).toFixed(1)} s` },
        { field: 'observation_count', value: String(object.observation_count) },
      ],
    });

    // --- whether the camera can still see them ------------------------------ //
    //
    // `is_stale` is the platform's own word for "this position was predicted,
    // not measured". Saying it in plain English matters more here than anywhere
    // else on the product: a viewer who does not know the difference will read a
    // remembered position as a live one.
    if (object.is_stale) {
      lines.push({
        id: `${object.object_id}:stale`,
        objectId: object.object_id,
        text: `The camera cannot see ${subject} at the moment. The position shown is where they were last measured, not where they are now.`,
        cites: [{ field: 'is_stale', value: 'true' }],
      });
    } else if (object.lifecycle === 'occluded') {
      lines.push({
        id: `${object.object_id}:occluded`,
        objectId: object.object_id,
        text: `${subject} is partly hidden from the camera.`,
        cites: [{ field: 'lifecycle', value: 'occluded' }],
      });
    }
  }

  return { headline, lines };
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
