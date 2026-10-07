import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ProjectRecord } from '../types/quote';
import { Building, Search, Check, X, MapPin, Users, ChevronDown, BookOpen, Layers } from 'lucide-react';

interface ProjectSelectorProps {
  projects: ProjectRecord[];
  currentProjectName: string;
  onSelectProject: (project: ProjectRecord) => void;
  onClearProject: () => void;
}

export const ProjectSelector: React.FC<ProjectSelectorProps> = ({
  projects,
  currentProjectName,
  onSelectProject,
  onClearProject,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Filter projects by search term
  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return projects.slice(0, 50);

    return projects.filter((p) => {
      return (
        p.projectName.toLowerCase().includes(q) ||
        (p.projectReference && p.projectReference.toLowerCase().includes(q)) ||
        (p.projectLocation && p.projectLocation.toLowerCase().includes(q)) ||
        (p.clientName && p.clientName.toLowerCase().includes(q)) ||
        (p.clientCompany && p.clientCompany.toLowerCase().includes(q)) ||
        (p.contactPerson && p.contactPerson.toLowerCase().includes(q))
      );
    });
  }, [projects, searchQuery]);

  // Check if current form matches a project record
  const matchingProject = useMemo(() => {
    if (!currentProjectName) return null;
    return projects.find(
      (p) => p.projectName.toLowerCase() === currentProjectName.toLowerCase()
    );
  }, [projects, currentProjectName]);

  const handleSelect = (project: ProjectRecord) => {
    onSelectProject(project);
    setSearchQuery('');
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={containerRef}>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <label className="text-[11px] font-bold uppercase tracking-wider text-[#1A1A1A] flex items-center gap-1.5 font-['Red_Hat_Display']">
          <Building className="w-3.5 h-3.5 text-[#C8102E]" />
          <span>Project Directory</span>
          <span className="text-[10px] font-mono text-slate-500 font-normal">
            ({projects.length} from "Projects" tab)
          </span>
        </label>

        {matchingProject ? (
          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-mono">
            <button
              type="button"
              onClick={onClearProject}
              className="text-slate-500 hover:text-[#C8102E] flex items-center gap-1 transition-colors px-1.5 py-0.5 border border-slate-300 hover:border-[#C8102E] bg-white font-bold cursor-pointer"
              title="Clear selected project"
            >
              <X className="w-3 h-3" />
              <span>Clear</span>
            </button>
          </div>
        ) : null}
      </div>

      {/* Search and Selection Trigger Bar */}
      <div className="relative">
        <div
          onClick={() => {
            setIsOpen(true);
            setTimeout(() => inputRef.current?.focus(), 50);
          }}
          className={`w-full flex items-center justify-between gap-2 px-3 py-2 bg-white border cursor-pointer transition-all ${
            matchingProject
              ? 'border-[#C8102E] bg-red-50/20 shadow-2xs'
              : 'border-[#CBD5E1] hover:border-[#C8102E]'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            {matchingProject ? (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
                <span className="text-xs font-bold text-[#1A1A1A] truncate">
                  {matchingProject.projectName}
                </span>
                {matchingProject.projectReference && (
                  <span className="text-[10px] font-mono bg-[#1A1A1A] text-white px-1.5 py-0.2 shrink-0">
                    {matchingProject.projectReference}
                  </span>
                )}
                {matchingProject.projectLocation && (
                  <span className="text-[10px] text-slate-500 truncate hidden sm:inline">
                    • {matchingProject.projectLocation}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-xs text-slate-400 font-medium truncate">
                Search or select scheme from Projects directory...
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {matchingProject && (
              <span className="bg-red-100 text-[#C8102E] text-[10px] font-bold px-1.5 py-0.5 border border-red-200 uppercase font-mono">
                Linked
              </span>
            )}
            <ChevronDown
              className={`w-4 h-4 text-slate-400 transition-transform ${
                isOpen ? 'rotate-180 text-[#C8102E]' : ''
              }`}
            />
          </div>
        </div>

        {/* Dropdown Results Panel */}
        {isOpen && (
          <div className="absolute left-0 right-0 top-full mt-1 bg-white border-2 border-[#1A1A1A] shadow-2xl z-50 max-h-80 flex flex-col font-['Red_Hat_Display']">
            {/* Search Filter Header */}
            <div className="p-2 bg-[#1A1A1A] flex items-center gap-2 border-b border-slate-700">
              <Search className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Type scheme name, reference, location, or client..."
                className="w-full text-xs font-medium text-white placeholder-slate-400 bg-transparent focus:outline-none font-mono"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-slate-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* List items container */}
            <div className="overflow-y-auto flex-1 divide-y divide-slate-100">
              {filteredProjects.length > 0 ? (
                filteredProjects.map((proj) => {
                  const isSelected =
                    currentProjectName.toLowerCase() === proj.projectName.toLowerCase();

                  return (
                    <div
                      key={proj.id}
                      onClick={() => handleSelect(proj)}
                      className={`p-3 cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-red-50/70 border-l-4 border-l-[#C8102E]'
                          : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-bold text-[#1A1A1A] truncate">
                              {proj.projectName}
                            </span>
                            {proj.projectReference && (
                              <span className="text-[10px] font-mono bg-slate-800 text-amber-300 px-1.5 py-0.2 shrink-0">
                                {proj.projectReference}
                              </span>
                            )}
                            {proj.areaM2 && (
                              <span className="text-[10px] font-mono bg-red-50 text-[#C8102E] font-bold px-1.5 py-0.2 border border-red-200 shrink-0 flex items-center gap-1">
                                <Layers className="w-2.5 h-2.5" />
                                {proj.areaM2} m²
                              </span>
                            )}
                          </div>

                          {proj.projectLocation && (
                            <div className="text-[11px] text-slate-600 flex items-center gap-1.5 mt-1 truncate">
                              <MapPin className="w-3 h-3 text-[#C8102E] shrink-0" />
                              <span className="truncate">{proj.projectLocation}</span>
                            </div>
                          )}
                        </div>

                        {isSelected && (
                          <span className="text-[#C8102E] font-bold text-xs flex items-center gap-1 shrink-0">
                            <Check className="w-4 h-4" />
                            <span>Selected</span>
                          </span>
                        )}
                      </div>

                      {/* Associated Client / Contractor */}
                      <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[10px] text-slate-500 font-mono">
                        {proj.clientName && (
                          <span className="flex items-center gap-1">
                            <Users className="w-2.5 h-2.5 text-slate-400" />
                            Client: <strong className="text-slate-700">{proj.clientName}</strong>
                          </span>
                        )}
                        {proj.clientCompany && (
                          <span className="flex items-center gap-1 truncate max-w-xs">
                            Contractor: <strong className="text-slate-700">{proj.clientCompany}</strong>
                          </span>
                        )}
                        {proj.assignedPriceBookCode && (
                          <span className="flex items-center gap-1 text-[#C8102E] font-bold">
                            <BookOpen className="w-2.5 h-2.5" />
                            <span>Price Book: {proj.assignedPriceBookCode}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="p-6 text-center text-slate-500 text-xs">
                  No projects found matching "<span className="font-semibold text-[#1A1A1A]">{searchQuery}</span>".
                </div>
              )}
            </div>

            {/* Dropdown Footer */}
            <div className="p-2 bg-[#F8F9FA] border-t border-[#CBD5E1] flex items-center justify-between text-[10px] text-slate-500 font-mono">
              <span>Showing {filteredProjects.length} of {projects.length} project records</span>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-[#C8102E] hover:underline font-bold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
