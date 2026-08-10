import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { PanelSurface } from './PanelSurface.jsx';
import markup from './markup/facebook.html';

flushSync(() => {
  createRoot(document.getElementById('react-root')).render(<PanelSurface markup={markup} />);
});

void import('../panel/facebook.js');
