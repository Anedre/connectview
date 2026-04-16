export interface CognitoUser {
  username: string;
  email: string;
  status: string;
  enabled: boolean;
  created: string;
  groups: string[];
}
