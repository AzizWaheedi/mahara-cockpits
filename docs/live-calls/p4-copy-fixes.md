# Project 4 copy fixes to make at build time (flagged by the Arabic writer, 2026-10-03)
1. **Join now and Holding** pass to the setter after 2 minutes, but the text says "I'm in the room". Add setter versions:
   - English: "{closer} is in the room now: {link}"
   - Arabic: {closer} بالاجتماع الحين وناطرك
2. **Hour** step: when the 09:00 floor applies (for example a 09:30 demo), "See you in an hour" is wrong. Use the real gap, or "See you at {time}".
3. **Written consent ask** goes from the official line, so "my number ending in {last_2}" reads wrong. Use "{setter}'s number ending in {last_2}".
4. **The group name** has no Arabic yet. It is mostly names, so no fix is needed.
5. **The CEO to check:**
   - الاجتماع versus مكالمة for "demo";
   - ليلحين and باجر for Saudi readers (versus للحين and بكرة);
   - the masculine address.
