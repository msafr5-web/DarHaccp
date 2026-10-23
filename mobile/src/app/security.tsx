import { AttemptsList } from '@/components/AttemptsList';

/** Company administrator: every login attempt on the company's accounts. */
export default function SecurityScreen() {
  return <AttemptsList path="/security/login-attempts" />;
}
