# Restore the original startup directory before zsh loads the user's configuration.
typeset -g _spark_zsh_highlight_dir=${${(%):-%x}:A:h}
if (( ${+SPARK_ZSH_ORIGINAL_ZDOTDIR} )); then
  export ZDOTDIR=$SPARK_ZSH_ORIGINAL_ZDOTDIR
else
  unset ZDOTDIR
fi
unset SPARK_ZSH_ORIGINAL_ZDOTDIR

if [[ -r ${ZDOTDIR-$HOME}/.zshenv ]]; then
  builtin source "${ZDOTDIR-$HOME}/.zshenv"
fi

if [[ -o rcs && -o interactive ]]; then
  # Wait until the user's .zshrc has defined its widgets and loaded its plugins.
  _spark_enable_zsh_highlighting() {
    add-zsh-hook -d precmd _spark_enable_zsh_highlighting
    if [[ -o rcs && -o zle ]] && (( ! $+functions[_zsh_highlight] && ! $+functions[_fast_highlight] )); then
      local ZSH_HIGHLIGHT_HIGHLIGHTERS_DIR="$_spark_zsh_highlight_dir/vendor/highlighters"
      builtin source "$_spark_zsh_highlight_dir/vendor/zsh-syntax-highlighting.zsh"
    fi
    unset _spark_zsh_highlight_dir
    return 0
  }
  autoload -Uz add-zsh-hook
  add-zsh-hook precmd _spark_enable_zsh_highlighting
else
  unset _spark_zsh_highlight_dir
fi

if [[ -o interactive ]]; then
  # Une commande absente échoue tout de suite : inutile de proposer un agent.
  # Le hash de zsh ignore les binaires installés après le démarrage du shell,
  # donc on interroge le PATH directement.
  _spark_in_path() {
    local dir
    for dir in ${(s.:.)PATH}; do
      [[ -x "$dir/$1" ]] && return 0
    done
    return 1
  }
  # Signale la commande lancée : Spark en déduit l'agent qui démarre.
  _spark_signal_command() {
    local word=${1%%[[:space:]]*}
    word=${word:t}
    if (( ! $+aliases[$word] && ! $+functions[$word] && ! $+builtins[$word] )); then
      _spark_in_path "$word" || return 0
    fi
    printf '\033]777;spark;%s\007' "$word"
  }
  autoload -Uz add-zsh-hook
  add-zsh-hook preexec _spark_signal_command
fi
