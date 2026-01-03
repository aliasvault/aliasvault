import { Redirect } from 'expo-router';

/**
 * App index which is the entry point of the app and redirects to the items screen.
 * If user is not logged in, they will automatically be redirected to the login screen instead
 * by global navigation handlers.
 */
export default function AppIndex() : React.ReactNode {
  return <Redirect href={'/items'} />;
}