import { defineAuth } from "@aws-amplify/backend";
import { postConfirmation } from "./post-confirmation/resource";

export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  groups: ["Agents", "Supervisors", "Admins"],
  triggers: {
    postConfirmation,
  },
  access: (allow) => [
    allow.resource(postConfirmation).to(["addUserToGroup"]),
  ],
});
