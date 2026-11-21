# Restore the original startup directory before zsh loads the user's configuration.
typeset -g _lab_zsh_highlight_dir=${${(%):-%x}:A:h}
if (( ${+LAB_ZSH_ORIGINAL_ZDOTDIR} )); then
  export ZDOTDIR=$LAB_ZSH_ORIGINAL_ZDOTDIR
else
  unset ZDOTDIR
fi
unset LAB_ZSH_ORIGINAL_ZDOTDIR

if [[ -r ${ZDOTDIR-$HOME}/.zshenv ]]; then
  builtin source "${ZDOTDIR-$HOME}/.zshenv"
fi

if [[ -o rcs && -o interactive ]]; then
  # Wait until the user's .zshrc has defined its widgets and loaded its plugins.
  _lab_enable_zsh_highlighting() {
    add-zsh-hook -d precmd _lab_enable_zsh_highlighting
    if [[ -o rcs && -o zle ]] && (( ! $+functions[_zsh_highlight] && ! $+functions[_fast_highlight] )); then
      local ZSH_HIGHLIGHT_HIGHLIGHTERS_DIR="$_lab_zsh_highlight_dir/vendor/highlighters"
      builtin source "$_lab_zsh_highlight_dir/vendor/zsh-syntax-highlighting.zsh"
    fi
    unset _lab_zsh_highlight_dir
    return 0
  }
  autoload -Uz add-zsh-hook
  add-zsh-hook precmd _lab_enable_zsh_highlighting
else
  unset _lab_zsh_highlight_dir
fi
