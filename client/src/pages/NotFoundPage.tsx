import { Link } from 'react-router';
import { Button, EmptyState } from '../components/ui';

export default function NotFoundPage() {
  return (
    <EmptyState
      title="Page not found"
      description="The page you're looking for doesn't exist."
      action={
        <Link to="/">
          <Button>Back to dashboard</Button>
        </Link>
      }
    />
  );
}
