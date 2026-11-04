import { Component } from "solid-js";
import accountTree from "@material-symbols/svg-400/outlined/account_tree.svg?raw";
import add from "@material-symbols/svg-400/outlined/add.svg?raw";
import smartToy from "@material-symbols/svg-400/outlined/smart_toy.svg?raw";
import bolt from "@material-symbols/svg-400/outlined/bolt.svg?raw";
import bookmark from "@material-symbols/svg-400/outlined/bookmark.svg?raw";
import cable from "@material-symbols/svg-400/outlined/cable.svg?raw";
import check from "@material-symbols/svg-400/outlined/check.svg?raw";
import chevronLeft from "@material-symbols/svg-400/outlined/chevron_left.svg?raw";
import chevronRight from "@material-symbols/svg-400/outlined/chevron_right.svg?raw";
import close from "@material-symbols/svg-400/outlined/close.svg?raw";
import code from "@material-symbols/svg-400/outlined/code.svg?raw";
import contentCopy from "@material-symbols/svg-400/outlined/content_copy.svg?raw";
import darkMode from "@material-symbols/svg-400/outlined/dark_mode.svg?raw";
import database from "@material-symbols/svg-400/outlined/database.svg?raw";
import deleteIcon from "@material-symbols/svg-400/outlined/delete.svg?raw";
import download from "@material-symbols/svg-400/outlined/download.svg?raw";
import edit from "@material-symbols/svg-400/outlined/edit.svg?raw";
import error from "@material-symbols/svg-400/outlined/error.svg?raw";
import formatListNumbered from "@material-symbols/svg-400/outlined/format_list_numbered.svg?raw";
import history from "@material-symbols/svg-400/outlined/history.svg?raw";
import key from "@material-symbols/svg-400/outlined/key.svg?raw";
import lightMode from "@material-symbols/svg-400/outlined/light_mode.svg?raw";
import logout from "@material-symbols/svg-400/outlined/logout.svg?raw";
import memory from "@material-symbols/svg-400/outlined/memory.svg?raw";
import playArrow from "@material-symbols/svg-400/outlined/play_arrow.svg?raw";
import playArrowFilled from "@material-symbols/svg-400/outlined/play_arrow-fill.svg?raw";
import refresh from "@material-symbols/svg-400/outlined/refresh.svg?raw";
import save from "@material-symbols/svg-400/outlined/save.svg?raw";
import schema from "@material-symbols/svg-400/outlined/schema.svg?raw";
import search from "@material-symbols/svg-400/outlined/search.svg?raw";
import settingsEthernet from "@material-symbols/svg-400/outlined/settings_ethernet.svg?raw";
import table from "@material-symbols/svg-400/outlined/table.svg?raw";
import tableRows from "@material-symbols/svg-400/outlined/table_rows.svg?raw";
import terminal from "@material-symbols/svg-400/outlined/terminal.svg?raw";
import upload from "@material-symbols/svg-400/outlined/upload.svg?raw";
import visibility from "@material-symbols/svg-400/outlined/visibility.svg?raw";

const icons: Record<string, string> = {
  account_tree: accountTree,
  add,
  smart_toy: smartToy,
  bolt,
  bookmark,
  cable,
  check,
  chevron_left: chevronLeft,
  chevron_right: chevronRight,
  close,
  code,
  content_copy: contentCopy,
  dark_mode: darkMode,
  database,
  delete: deleteIcon,
  download,
  edit,
  error,
  format_list_numbered: formatListNumbered,
  history,
  key,
  light_mode: lightMode,
  logout,
  memory,
  play_arrow: playArrow,
  refresh,
  save,
  schema,
  search,
  settings_ethernet: settingsEthernet,
  table,
  table_rows: tableRows,
  terminal,
  upload,
  visibility,
};

interface IconProps {
  name: string;
  class?: string;
  filled?: boolean;
}

const Icon: Component<IconProps> = (props) => (
  <span
    class={`material-symbol ${props.class || "size-5"}`}
    innerHTML={props.filled && props.name === "play_arrow" ? playArrowFilled : icons[props.name] || ""}
    aria-hidden="true"
  />
);

export default Icon;
