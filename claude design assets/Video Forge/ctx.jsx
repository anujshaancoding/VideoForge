/* Shared editor context (created once, consumed across files) */
const EditorCtx = React.createContext(null);
const useEditor = () => React.useContext(EditorCtx);
Object.assign(window, { EditorCtx, useEditor });
