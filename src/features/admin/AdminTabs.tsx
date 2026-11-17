import { NavLink } from 'react-router-dom'

import { paths } from '../../app/router/paths'

/** The admin area's sections, under each list page's heading. */
export function AdminTabs() {
  return (
    <nav className="admin-tabs" aria-label="Admin sections">
      <NavLink to={paths.admin} end className={({ isActive }) => (isActive ? 'active' : undefined)}>Review queue</NavLink>
      <NavLink to={paths.adminMatches} end className={({ isActive }) => (isActive ? 'active' : undefined)}>Matches</NavLink>
      <NavLink to={paths.adminDisputes} end className={({ isActive }) => (isActive ? 'active' : undefined)}>Disputes</NavLink>
    </nav>
  )
}
