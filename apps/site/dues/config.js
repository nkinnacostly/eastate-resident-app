// Where the payment endpoints live.
//
// A separate file rather than inlined, so the two pages share one definition
// and a project move is a one-line change. Public by nature: this is the same
// host the mobile apps already talk to, and every endpoint behind it
// authenticates on its own terms.
window.__FN__ = 'https://iglwvlaojdmnkqyvhyvp.supabase.co/functions/v1';
