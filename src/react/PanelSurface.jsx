import React, { useMemo } from 'react';
import parse from 'html-react-parser';

export function PanelSurface({ markup }) {
  const panelElements = useMemo(() => parse(markup), [markup]);
  return <div className="react-panel-root">{panelElements}</div>;
}
