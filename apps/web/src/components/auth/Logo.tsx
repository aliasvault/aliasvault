import React from 'react';
import { Link } from 'react-router-dom';

/**
 * The AliasVault logo shown above the auth cards.
 */
const Logo: React.FC = () => (
  <Link to="/">
    <div className="text-5xl font-bold text-gray-900 dark:text-white mb-4 flex items-center mt-12 lg:mt-0">
      <img src="/img/logo.svg" alt="AliasVault" className="w-20 h-20 mr-2" />
      <span className="relative inline-flex flex-wrap items-center">
        AliasVault
        <span className="ml-2 bg-primary-500 text-white text-xs px-2 py-0.5 rounded-full font-normal sm:-top-2 sm:ml-1">BETA</span>
      </span>
    </div>
  </Link>
);

export default Logo;
