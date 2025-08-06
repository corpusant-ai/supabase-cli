import { createClient } from "npm:@pgkit/client";
import { Migration } from "npm:@pgkit/migra";

const clientBase = createClient(Deno.env.get("SOURCE"));
const clientHead = createClient(Deno.env.get("TARGET"));
const includedSchemas = Deno.env.get("INCLUDED_SCHEMAS");
const excludedSchemas = Deno.env.get("EXCLUDED_SCHEMAS");

try {
  let sql = "";
  if (includedSchemas) {
    for (const schema of includedSchemas.split(",")) {
      const m = await Migration.create(clientBase, clientHead, {
        schema,
        ignore_extension_versions: true,
      });
      m.set_safety(false);
      m.add_all_changes(true);
      sql += m.sql;
    }
  } else {
    // Omit dependencies by diffing extensions first
    const e = await Migration.create(clientBase, clientHead, {
      ignore_extension_versions: true,
    });
    e.set_safety(false);
    e.add_extension_changes();
    sql += e.sql;
    // Then diff user defined entities in non-managed schemas
    const m = await Migration.create(clientBase, clientHead, {
      exclude_schema: excludedSchemas?.split(","),
      ignore_extension_versions: true,
    });
    m.set_safety(false);
    m.add_all_changes(true);
    sql += m.sql;
    // For managed schemas, we want to include triggers and RLS policies
    for (const schema of ["auth", "storage", "realtime"]) {
      const s = await Migration.create(clientBase, clientHead, {
        schema,
        ignore_extension_versions: true,
      });
      s.set_safety(false);
      s.add(s.changes.triggers({ drops_only: true }));
      s.add(s.changes.rlspolicies({ drops_only: true }));
      s.add(s.changes.rlspolicies({ creations_only: true }));
      s.add(s.changes.triggers({ creations_only: true }));
      sql += s.sql;
    }
  }
  console.log(sql);
} finally {
  await Promise.all([clientHead.end(), clientBase.end()]);
}
