import React from 'react';
import { Navigate } from 'react-router-dom';

/**
 * The default entry page redirects to the vault.
 */
const Home: React.FC = () => <Navigate to="/items" replace />;

export default Home;
